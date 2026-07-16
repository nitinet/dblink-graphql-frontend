import { collection, exprBuilder } from 'dblink';
import Context from 'dblink/src/Context.js';
import FieldMapping from 'dblink/src/exprBuilder/FieldMapping.js';
import { cloneDeep } from 'lodash-es';
import {
  GraphQLEnumType,
  GraphQLFieldConfigMap,
  GraphQLInputFieldConfigMap,
  GraphQLInputObjectType,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
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

export interface ListArgs {
  filter?: AnyRecord;
  orderBy?: { field: string; direction?: string };
  limit?: number;
  offset?: number;
}

/**
 * Apply GraphQL query arguments (filter, orderBy, limit/offset) to a queryset.
 * Only fields in `knownFields` are accepted — unknown keys are silently ignored.
 */
export function applyArgs<T extends AnyRecord>(qs: collection.IQuerySet<T>, args: ListArgs, knownFields: Set<string>): collection.IQuerySet<T> {
  if (args.filter) {
    for (const [field, value] of Object.entries(args.filter)) {
      if (value === undefined || value === null) continue;
      if (!knownFields.has(field)) continue;
      const f = field as keyof T;
      const v = value as T[keyof T];
      qs = qs.where(eb => (eb as exprBuilder.WhereExprBuilder<T>).eq(f, v));
    }
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
    filterFields[fn] = { type: gqlType };
  }

  const ObjectType = new GraphQLObjectType({ name, fields: objectTypeFields });

  const FilterInput = new GraphQLInputObjectType({
    name: `${name}Filter`,
    fields: filterFields
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
      filterFields[fieldName] = { type: gqlType };
    }

    const ObjectType = new GraphQLObjectType({ name: typeName, fields: objectTypeFields });

    const FilterInput = new GraphQLInputObjectType({
      name: `${typeName}Filter`,
      fields: filterFields
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
