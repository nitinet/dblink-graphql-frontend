/**
 * A single field's operator object in the generated `{Name}Filter` GraphQL input type
 * (see `schemaBuilder.ts`'s `getFilterInputType`/`buildFilterExpression`). Not every operator
 * applies to every field server-side (e.g. `like`/`between` aren't offered for booleans) -
 * the generated GraphQL schema is the source of truth for that; this type only gives consumers
 * a concrete shape to type `filter` arguments against instead of `unknown`.
 */
export interface FilterOperators<T> {
  eq?: T;
  neq?: T;
  gt?: T;
  gte?: T;
  lt?: T;
  lte?: T;
  like?: T;
  in?: T[];
  notIn?: T[];
  between?: { from: T; to: T };
  isNull?: boolean;
}

/**
 * Mirrors the `{Name}Filter` GraphQL input type generated for an entity `T`: every field takes
 * an operator object rather than a bare scalar, `and` ANDs nested filters in, and `or`
 * recursively ORs nested filters together and ANDs the result with the rest (see
 * `buildFilterExpression` for the exact composition rules).
 *
 * @example
 * ```ts
 * type UserFilter = Filter<User>;
 * const filter: UserFilter = { status: { eq: true }, or: [{ username: { like: '%jo%' } }] };
 * ```
 */
export type Filter<T> = {
  [K in keyof T]?: FilterOperators<T[K]>;
} & {
  and?: Filter<T>[];
  or?: Filter<T>[];
};
