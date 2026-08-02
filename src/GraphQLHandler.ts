import Context from 'dblink/src/Context.js';
import { DocumentNode, ExecutionResult, GraphQLSchema, execute, parse, validate } from 'graphql';
import { buildSchema } from './schemaBuilder.js';

/**
 * GraphQLHandler
 *
 * Wraps a dblink `Context` and exposes a single `execute()` method.
 *
 * The GraphQL schema is derived automatically from every `TableSet` that has
 * been registered in the context (via `context.init()`), so the schema reflects
 * the same entities — and supports full GraphQL introspection — without any
 * manual schema definition.
 *
 * @example
 * ```ts
 * const handler = new GraphQLHandler(myContext);
 *
 * const result = await handler.execute(`
 *   query {
 *     users(filter: { name: { eq: "Alice" } }, limit: 10) {
 *       id
 *       name
 *       email
 *     }
 *   }
 * `);
 * ```
 */
export class GraphQLHandler {
  private readonly schema: GraphQLSchema;

  constructor(context: Context) {
    this.schema = buildSchema(context);
  }

  /**
   * Returns the generated `GraphQLSchema` — useful for introspection queries
   * or plugging into an HTTP middleware (Apollo Server, graphql-http, etc.).
   */
  getSchema(): GraphQLSchema {
    return this.schema;
  }

  /**
   * Parses, validates, and executes a GraphQL query string against the
   * dblink context. Only queries are supported — the generated schema has
   * no mutation or subscription type.
   *
   * @param source       - GraphQL query string or pre-parsed `DocumentNode`
   * @param variables    - Optional variable map
   * @param operationName - Optional operation name when the document contains
   *                        multiple named operations
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
