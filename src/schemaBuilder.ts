import { collection, exprBuilder } from 'dblink';
import Context from 'dblink/src/Context.js';
import FieldMapping from 'dblink/src/exprBuilder/FieldMapping.js';
import Expression from 'dblink-core/src/sql/Expression.js';
import { cloneDeep } from 'lodash-es';
import {
  GraphQLBoolean,
  GraphQLEnumType,
  GraphQLFieldConfigMap,
  GraphQLFloat,
  GraphQLInputFieldConfigMap,
  GraphQLInputObjectType,
  GraphQLInputType,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLScalarType,
  GraphQLSchema,
  GraphQLString
} from 'graphql';
import { jsTypeToGraphQL } from './typeMapper.js';

/** Generic record used for type-safe QuerySet chaining at runtime. */
type AnyRecord = Record<string, unknown>;

/**
 * Internal shape of an IQuerySet — exposes properties not on the public
 * interface but always present on concrete QuerySet / TableSet instances.
 *
 * `dbSet` is absent on JoinQuerySet; `leftQuerySet`/`rightQuerySet` are
 * present only on JoinQuerySet.
 */
type InternalQS<T extends object> = collection.IQuerySet<T> & {
  dbSet?: { fieldMap: Map<string, FieldMapping> };
  leftQuerySet?: InternalQS<object>;
  rightQuerySet?: InternalQS<object>;
  initColumnFieldMap(): void;
  context?: unknown;
};

/**
 * Returns true when the queryset is a JoinQuerySet (has left + right halves).
 */
function isJoinQuerySet<T extends object>(qs: InternalQS<T>): boolean {
  return qs.leftQuerySet !== undefined && qs.rightQuerySet !== undefined;
}

/**
 * Build a unified `fieldName → FieldMapping` map for any queryset.
 *
 * - For a `TableSet` / `QuerySet`: delegates straight to `dbSet.fieldMap`.
 * - For a `JoinQuerySet`: merges the maps from both sides recursively.
 *   When both sides share a field name (e.g. `id`), the right-hand side
 *   wins — consistent with `JoinQuerySet`'s own transformer behaviour.
 */
function getCombinedFieldMap<T extends object>(qs: InternalQS<T>): Map<string, FieldMapping> {
  if (isJoinQuerySet(qs) && qs.leftQuerySet && qs.rightQuerySet) {
    const combined = new Map<string, FieldMapping>();
    getCombinedFieldMap(qs.leftQuerySet).forEach((mapping, fieldName) => combined.set(fieldName, mapping));
    getCombinedFieldMap(qs.rightQuerySet).forEach((mapping, fieldName) => combined.set(fieldName, mapping));
    return combined;
  }
  return qs.dbSet?.fieldMap ?? new Map<string, FieldMapping>();
}

/** Shared enum for sort direction — one instance shared across all schemas. */
const OrderDirectionEnum = new GraphQLEnumType({
  name: 'OrderDirection',
  values: {
    ASC: { value: 'ASC' },
    DESC: { value: 'DESC' }
  }
});

/** Operators offered on numeric-ish scalars that support ordering (Float, Int). */
const NUMERIC_FILTER_OPS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn', 'between', 'isNull'] as const;
/** Operators offered on String — adds pattern matching, keeps ordering out (not meaningful via GraphQL args here). */
const STRING_FILTER_OPS = ['eq', 'neq', 'like', 'in', 'notIn', 'isNull'] as const;
/** Operators offered on Boolean/ID — equality + membership + null-check only; no ordering, no `like`, no `between`. */
const EQUALITY_ONLY_FILTER_OPS = ['eq', 'neq', 'in', 'notIn', 'isNull'] as const;

type FilterOp = (typeof NUMERIC_FILTER_OPS)[number] | (typeof STRING_FILTER_OPS)[number] | (typeof EQUALITY_ONLY_FILTER_OPS)[number];

/** Picks the operator set for a scalar type by identity against the well-known GraphQL scalars. */
function filterOpsForType(gqlType: GraphQLScalarType): readonly FilterOp[] {
  if (gqlType === GraphQLFloat || gqlType === GraphQLInt) return NUMERIC_FILTER_OPS;
  if (gqlType === GraphQLString) return STRING_FILTER_OPS;
  return EQUALITY_ONLY_FILTER_OPS; // GraphQLBoolean, GraphQLID
}

/**
 * A literal boolean predicate (e.g. `1 = 1`) wrapped so it satisfies dblink's
 * own `isValidExpression` guard (`exps.length > 0`), which a bare
 * `new Expression(sql)` leaf would fail on its own — the guard would silently
 * drop it if it were the only filter condition. `.and()` with itself is a
 * no-op wrapper that gives it one child, not a real second predicate.
 */
function literalExpression(sql: string): Expression {
  const leaf = new Expression(sql);
  return leaf.and(leaf);
}

/**
 * Builds the `Expression` for a single filter operator via a `WhereExprBuilder` method.
 * `gte`/`lte` map to dblink's `gteq`/`lteq` methods; `notIn` composes `in(...).not()`
 * since `WhereExprBuilder` has no direct `notIn`; `isNull` picks `isNull`/`isNotNull`
 * based on the boolean flag value (it takes no operand); an empty `in`/`notIn` list is
 * special-cased to the semantically correct literal (SQL's `IN ()` is invalid syntax,
 * not "matches nothing"); every other operator name matches a `WhereExprBuilder` method
 * directly.
 */
function buildOperandExpression<T extends AnyRecord>(eb: exprBuilder.WhereExprBuilder<T>, field: keyof T, op: FilterOp, value: unknown): Expression {
  switch (op) {
    case 'gte':
      return eb.gteq(field, value as T[keyof T]);
    case 'lte':
      return eb.lteq(field, value as T[keyof T]);
    case 'in': {
      const list = value as T[keyof T][];
      if (list.length === 0) return literalExpression('1 = 0'); // "in nothing" matches no rows
      return eb.in(field, ...list);
    }
    case 'notIn': {
      const list = value as T[keyof T][];
      if (list.length === 0) return literalExpression('1 = 1'); // "not in nothing" matches every row
      return eb.in(field, ...list).not();
    }
    case 'isNull':
      return value ? eb.isNull(field) : eb.isNotNull(field);
    case 'between': {
      const { from, to } = value as { from: T[keyof T]; to: T[keyof T] };
      return eb.between(field, from, to);
    }
    default:
      return eb[op](field, value as T[keyof T]);
  }
}

/** Per-scalar `{Scalar}Filter` input types, cached across every schema built in the process. */
const sharedFilterTypeCache = new Map<GraphQLScalarType, GraphQLInputObjectType>();
/** Per-scalar `{Scalar}Range` input types (used by `between`), cached the same way. */
const sharedRangeTypeCache = new Map<GraphQLScalarType, GraphQLInputObjectType>();

/**
 * Returns the `{Scalar}Range` input type (`{ from, to }`) for a given scalar,
 * building and caching it on first use. Backs the `between` operator.
 */
function getRangeInputType(gqlType: GraphQLScalarType): GraphQLInputObjectType {
  const cached = sharedRangeTypeCache.get(gqlType);
  if (cached) return cached;

  const rangeInputType = new GraphQLInputObjectType({
    name: `${gqlType.name}Range`,
    fields: {
      from: { type: new GraphQLNonNull(gqlType) },
      to: { type: new GraphQLNonNull(gqlType) }
    }
  });
  sharedRangeTypeCache.set(gqlType, rangeInputType);
  return rangeInputType;
}

/**
 * Picks the GraphQL input type for a single operator field within a `{Scalar}Filter`.
 * `in`/`notIn` take a list of the scalar, `isNull` takes a bare `Boolean` flag,
 * `between` takes a `{Scalar}Range` — every other operator takes the scalar itself.
 */
function filterOperandType(op: FilterOp, gqlType: GraphQLScalarType): GraphQLInputType {
  switch (op) {
    case 'in':
    case 'notIn':
      return new GraphQLList(new GraphQLNonNull(gqlType));
    case 'isNull':
      return GraphQLBoolean;
    case 'between':
      return getRangeInputType(gqlType);
    default:
      return gqlType;
  }
}

/**
 * Returns the `{Scalar}Filter` input type for a given scalar (e.g. `FloatFilter`,
 * `StringFilter`), building and caching it on first use.
 */
function getFilterInputType(gqlType: GraphQLScalarType): GraphQLInputObjectType {
  const cached = sharedFilterTypeCache.get(gqlType);
  if (cached) return cached;

  const ops = filterOpsForType(gqlType);
  const fields: GraphQLInputFieldConfigMap = {};
  for (const op of ops) {
    fields[op] = { type: filterOperandType(op, gqlType) };
  }

  const filterInputType = new GraphQLInputObjectType({
    name: `${gqlType.name}Filter`,
    fields
  });
  sharedFilterTypeCache.set(gqlType, filterInputType);
  return filterInputType;
}

/**
 * Recursively builds a single `Expression` tree from a `{Name}Filter`-shaped object:
 * every present field's operators AND together; an `and` array of nested filter objects
 * ANDs its branches in (redundant with just merging fields into one object, but lets
 * multiple independent `or` groups be combined explicitly, e.g. `(a OR b) AND (c OR d)`);
 * an `or` array of nested filter objects ORs its branches and ANDs the result with the rest.
 * Returns `undefined` when the object contributes nothing (e.g. all-unknown fields).
 */
function buildFilterExpression<T extends AnyRecord>(eb: exprBuilder.WhereExprBuilder<T>, filter: AnyRecord, knownFields: Set<string>): Expression | undefined {
  let combined: Expression | undefined;

  for (const [field, opValue] of Object.entries(filter)) {
    if (field === 'and' || field === 'or') continue;
    if (opValue === undefined || opValue === null) continue;
    if (!knownFields.has(field)) continue;
    const f = field as keyof T;
    for (const [op, value] of Object.entries(opValue as AnyRecord)) {
      if (value === undefined || value === null) continue;
      const expr = buildOperandExpression(eb, f, op as FilterOp, value);
      combined = combined ? combined.and(expr) : expr;
    }
  }

  const andBranches = filter.and;
  if (Array.isArray(andBranches) && andBranches.length > 0) {
    for (const branch of andBranches as AnyRecord[]) {
      const branchExpr = buildFilterExpression(eb, branch, knownFields);
      if (!branchExpr) continue;
      combined = combined ? combined.and(branchExpr) : branchExpr;
    }
  }

  const orBranches = filter.or;
  if (Array.isArray(orBranches) && orBranches.length > 0) {
    let orCombined: Expression | undefined;
    for (const branch of orBranches as AnyRecord[]) {
      const branchExpr = buildFilterExpression(eb, branch, knownFields);
      if (!branchExpr) continue;
      orCombined = orCombined ? orCombined.or(branchExpr) : branchExpr;
    }
    if (orCombined) {
      combined = combined ? combined.and(orCombined) : orCombined;
    }
  }

  return combined;
}

export interface ListArgs {
  filter?: AnyRecord;
  orderBy?: { field: string; direction?: string };
  limit?: number;
  offset?: number;
}

/**
 * Apply GraphQL query arguments (filter, orderBy, limit/offset) to a queryset.
 * Only fields in `knownFields` are accepted — unknown keys are silently ignored.
 *
 * Each filter field's value is an operator object (e.g. `{ gte: 2, lte: 6 }`);
 * every operator present is ANDed together. An `and` array of nested filter
 * objects (same shape, recursive) ANDs its branches in — redundant with plain
 * fields unless combined with multiple independent `or` groups. An `or` array
 * ORs its branches and ANDs the result with the rest of the filter.
 */
export function applyArgs<T extends AnyRecord>(qs: collection.IQuerySet<T>, args: ListArgs, knownFields: Set<string>): collection.IQuerySet<T> {
  if (args.filter) {
    const filter = args.filter;
    // qs.where() requires the callback to return an Expression (not undefined);
    // an empty Expression has no sub-expressions, so dblink's own isValidExpression
    // guard treats it as a no-op, matching "nothing to filter" behavior.
    qs = qs.where(eb => buildFilterExpression(eb as exprBuilder.WhereExprBuilder<T>, filter, knownFields) ?? new Expression());
  }

  if (args.orderBy) {
    const { field, direction } = args.orderBy;
    if (knownFields.has(field)) {
      const f = field as keyof T;
      qs = qs.orderBy(eb => {
        const o = eb as exprBuilder.OrderExprBuilder<T>;
        return direction === 'DESC' ? [o.desc(f)] : [o.asc(f)];
      });
    }
  }

  if (args.limit !== undefined) {
    qs = qs.limit(args.limit, args.offset);
  }

  return qs;
}

/**
 * Return a safe copy of the queryset for a single request.
 *
 * Deep-clones the queryset so per-request mutations (where/orderBy/limit) do
 * not accumulate on the original, but reuses the original `context` reference
 * so the database connection pool is never cloned.
 */
function freshQuerySet<T extends object>(base: collection.IQuerySet<T>): collection.IQuerySet<T> {
  const originalContext = (base as InternalQS<T>).context;
  const fresh = cloneDeep(base);
  if (originalContext !== undefined) {
    (fresh as InternalQS<T>).context = originalContext;
  }
  return fresh;
}

/**
 * Build a `GraphQLSchema` from a single `IQuerySet`.
 *
 * The schema reflects exactly the fields exposed by the queryset — any prior
 * `.select()` call is honoured, so the introspection surface matches precisely
 * what the queryset will return.
 *
 * Generated per entity:
 *  - `{Name}`        — object type
 *  - `{Name}Filter`  — equality filter input
 *  - `{Name}OrderBy` — sort input
 *  - `{Name}List`    — `{ count, values }` result type
 *
 * Generated query fields:
 *  - `{names}`        — list  (filter / orderBy / limit / offset)
 *  - `{names}Count`   — row count  (filter)
 *  - `{names}List`    — count + rows  (filter / orderBy / limit / offset)
 */
export function buildSchemaFromQuerySet<T extends object>(queryset: collection.IQuerySet<T>, name: string): GraphQLSchema {
  const qs = queryset as InternalQS<T>;

  // Populate columnFieldMap from entity decorator metadata.
  // initColumnFieldMap() is a no-op when select() has already set the map,
  // so a narrowed queryset keeps only its selected fields.
  qs.initColumnFieldMap();

  const { columnFieldMap } = qs; // colName (or alias_colName for joins) → fieldName
  const fieldMap = getCombinedFieldMap(qs); // fieldName → FieldMapping (dataType, primaryKey)

  if (columnFieldMap.size === 0) {
    throw new Error(`buildSchemaFromQuerySet: queryset for "${name}" has no mapped fields.`);
  }

  const knownFields = new Set<string>();
  const objectTypeFields: GraphQLFieldConfigMap<unknown, unknown> = {};
  const filterFields: GraphQLInputFieldConfigMap = {};

  for (const fieldName of columnFieldMap.values()) {
    const mapping = fieldMap.get(fieldName as string);
    if (!mapping) continue;

    const fn = fieldName as string;
    knownFields.add(fn);
    const gqlType = jsTypeToGraphQL(mapping.dataType, mapping.primaryKey);
    objectTypeFields[fn] = { type: gqlType };
    filterFields[fn] = { type: getFilterInputType(gqlType) };
  }

  const ObjectType = new GraphQLObjectType({ name, fields: objectTypeFields });

  // `fields` is a thunk so the `and`/`or` fields can reference FilterInput itself —
  // GraphQL input types may be self-referential as long as the fields are lazy.
  const FilterInput: GraphQLInputObjectType = new GraphQLInputObjectType({
    name: `${name}Filter`,
    fields: () => ({
      ...filterFields,
      and: { type: new GraphQLList(new GraphQLNonNull(FilterInput)) },
      or: { type: new GraphQLList(new GraphQLNonNull(FilterInput)) }
    })
  });

  const OrderByInput = new GraphQLInputObjectType({
    name: `${name}OrderBy`,
    fields: {
      field: { type: new GraphQLNonNull(GraphQLString) },
      direction: { type: OrderDirectionEnum }
    }
  });

  const ListResultType = new GraphQLObjectType({
    name: `${name}List`,
    fields: {
      count: { type: new GraphQLNonNull(GraphQLInt) },
      values: { type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(ObjectType))) }
    }
  });

  const listArgs = {
    filter: { type: FilterInput },
    orderBy: { type: OrderByInput },
    limit: { type: GraphQLInt },
    offset: { type: GraphQLInt }
  };

  function resolveQS(args: ListArgs): collection.IQuerySet<AnyRecord> {
    return applyArgs(freshQuerySet(queryset) as unknown as collection.IQuerySet<AnyRecord>, args, knownFields);
  }

  const queryName = name.charAt(0).toLowerCase() + name.slice(1) + 's';

  const queryFields: GraphQLFieldConfigMap<unknown, unknown> = {
    [queryName]: {
      type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(ObjectType))),
      args: listArgs,
      resolve(_root, args) {
        return resolveQS(args as ListArgs).list();
      }
    },
    [`${queryName}Count`]: {
      type: new GraphQLNonNull(GraphQLInt),
      args: { filter: { type: FilterInput } },
      resolve(_root, args) {
        return resolveQS(args as ListArgs).count();
      }
    },
    [`${queryName}List`]: {
      type: new GraphQLNonNull(ListResultType),
      args: listArgs,
      resolve(_root, args) {
        return resolveQS(args as ListArgs).listAndCount();
      }
    }
  };

  return new GraphQLSchema({
    query: new GraphQLObjectType({ name: 'Query', fields: queryFields })
  });
}

/**
 * Build a `GraphQLSchema` covering every `TableSet` registered in a dblink
 * `Context`.  Use `buildSchemaFromQuerySet` instead when you want a focused
 * schema for a single queryset.
 */
export function buildSchema(context: Context): GraphQLSchema {
  if (context.tableSetMap.size === 0) {
    throw new Error('GraphQLHandler: the Context has no registered TableSets. ' + 'Ensure context.init() has been called before building the schema.');
  }

  const queryFields: GraphQLFieldConfigMap<unknown, unknown> = {};

  for (const [EntityType, rawTableSet] of context.tableSetMap) {
    const typeName = EntityType.name;
    const tableSet = rawTableSet as unknown as collection.TableSet<AnyRecord>;
    const { fieldMap } = tableSet.dbSet;

    const knownFields = new Set(fieldMap.keys());

    const objectTypeFields: GraphQLFieldConfigMap<unknown, unknown> = {};
    const filterFields: GraphQLInputFieldConfigMap = {};

    for (const [fieldName, mapping] of fieldMap.entries()) {
      const gqlType = jsTypeToGraphQL(mapping.dataType, mapping.primaryKey);
      objectTypeFields[fieldName] = { type: gqlType };
      filterFields[fieldName] = { type: getFilterInputType(gqlType) };
    }

    const ObjectType = new GraphQLObjectType({ name: typeName, fields: objectTypeFields });

    // `fields` is a thunk so the `and`/`or` fields can reference FilterInput itself —
    // GraphQL input types may be self-referential as long as the fields are lazy.
    const FilterInput: GraphQLInputObjectType = new GraphQLInputObjectType({
      name: `${typeName}Filter`,
      fields: () => ({
        ...filterFields,
        and: { type: new GraphQLList(new GraphQLNonNull(FilterInput)) },
        or: { type: new GraphQLList(new GraphQLNonNull(FilterInput)) }
      })
    });

    const OrderByInput = new GraphQLInputObjectType({
      name: `${typeName}OrderBy`,
      fields: {
        field: { type: new GraphQLNonNull(GraphQLString) },
        direction: { type: OrderDirectionEnum }
      }
    });

    const ListResultType = new GraphQLObjectType({
      name: `${typeName}List`,
      fields: {
        count: { type: new GraphQLNonNull(GraphQLInt) },
        values: { type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(ObjectType))) }
      }
    });

    const listArgs = {
      filter: { type: FilterInput },
      orderBy: { type: OrderByInput },
      limit: { type: GraphQLInt },
      offset: { type: GraphQLInt }
    };

    const queryName = typeName.charAt(0).toLowerCase() + typeName.slice(1) + 's';

    queryFields[queryName] = {
      type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(ObjectType))),
      args: listArgs,
      resolve(_root, args) {
        return applyArgs(tableSet, args as ListArgs, knownFields).list();
      }
    };

    queryFields[`${queryName}Count`] = {
      type: new GraphQLNonNull(GraphQLInt),
      args: { filter: { type: FilterInput } },
      resolve(_root, args) {
        return applyArgs(tableSet, args as ListArgs, knownFields).count();
      }
    };

    queryFields[`${queryName}List`] = {
      type: new GraphQLNonNull(ListResultType),
      args: listArgs,
      resolve(_root, args) {
        return applyArgs(tableSet, args as ListArgs, knownFields).listAndCount();
      }
    };
  }

  return new GraphQLSchema({
    query: new GraphQLObjectType({ name: 'Query', fields: queryFields })
  });
}
