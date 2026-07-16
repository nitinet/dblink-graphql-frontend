import { collection } from 'dblink';
import { DocumentNode, ExecutionResult, GraphQLSchema, execute, parse, validate } from 'graphql';
import { buildSchemaFromQuerySet } from './schemaBuilder.js';

/**
 * QuerySetGraphQLHandler
 *
 * Wraps a single dblink `IQuerySet` (a `TableSet` or an already-filtered
 * `QuerySet`) and exposes a GraphQL interface over it.
 *
 * The schema — and therefore introspection — reflects exactly the fields
 * that the queryset exposes.  When the queryset was narrowed with `.select()`,
 * only those selected fields appear in the schema.
 *
 * Each `execute()` call gets a fresh copy of the base queryset so that
 * per-request filters and sort clauses never bleed into subsequent requests.
 *
 * @example — full table
 * ```ts
 * await ctx.init();
 * const handler = new QuerySetGraphQLHandler(ctx.users, 'User');
 *
 * const result = await handler.execute(`
 *   { users(filter: { name: "Alice" }, limit: 10) { id name email } }
 * `);
 * ```
 *
 * @example — pre-filtered queryset (only active users)
 * ```ts
 * const activeUsers = ctx.users.where(eb => eb.eq('status', 'active'));
 * const handler = new QuerySetGraphQLHandler(activeUsers, 'ActiveUser');
 * ```
 *
 * @example — column-narrowed queryset (no email in schema or results)
 * ```ts
 * const narrowed = ctx.users.select(['id', 'name']);
 * const handler = new QuerySetGraphQLHandler(narrowed, 'UserSummary');
 * ```
 */
export class QuerySetGraphQLHandler<T extends object> {
  private readonly schema: GraphQLSchema;

  constructor(queryset: collection.IQuerySet<T>, name: string) {
    this.schema = buildSchemaFromQuerySet(queryset, name);
  }

  /**
   * Returns the generated `GraphQLSchema`.
   *
   * Pass this to an HTTP middleware (Apollo Server, graphql-http, etc.) or use
   * it directly for introspection queries.
   */
  getSchema(): GraphQLSchema {
    return this.schema;
  }

  /**
   * Parse, validate, and execute a GraphQL query against the queryset.
   *
   * @param source         - GraphQL query string or pre-parsed `DocumentNode`
   * @param variables      - Optional variable map
   * @param operationName  - Optional operation name for multi-operation documents
   */
  async execute(source: string | DocumentNode, variables?: Record<string, unknown>, operationName?: string): Promise<ExecutionResult> {
    const document: DocumentNode = typeof source === 'string' ? parse(source) : source;

    const errors = validate(this.schema, document);
    if (errors.length > 0) {
      return { errors };
    }

    return execute({
      schema: this.schema,
      document,
      variableValues: variables,
      operationName
    });
  }
}
