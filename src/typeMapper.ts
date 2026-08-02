// A regular `import type` of the ambient .d.ts wouldn't be re-discovered by an external
// consumer's tsc (this package's `types` field points at raw .ts source, so a consumer
// only follows the `import` graph - sibling ambient .d.ts files outside that graph are
// invisible to it). The triple-slash reference is the one mechanism TS honors regardless
// of which project is doing the compiling.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./class-transformer-storage.d.ts" />
import { defaultMetadataStorage } from 'class-transformer/cjs/storage.js';
import { GraphQLBoolean, GraphQLFloat, GraphQLID, GraphQLScalarType, GraphQLString } from 'graphql';

/**
 * Maps a JavaScript/TypeScript constructor type to the appropriate GraphQL scalar.
 * Primary-key fields are always mapped to `GraphQLID`.
 */
export function jsTypeToGraphQL(dataType: unknown, isPrimaryKey: boolean): GraphQLScalarType {
  if (isPrimaryKey) return GraphQLID;
  switch (dataType) {
    case String:
      return GraphQLString;
    case Number:
      return GraphQLFloat;
    case Boolean:
      return GraphQLBoolean;
    default:
      return GraphQLString;
  }
}

/**
 * True when a field's reflected `design:type` is `Array` - i.e. an array-shaped
 * column (e.g. a Postgres `varchar[]`/`text[]` column such as `tags`). Primary
 * keys are never treated as arrays regardless of their declared type.
 */
export function isArrayType(dataType: unknown, isPrimaryKey: boolean): boolean {
  return !isPrimaryKey && dataType === Array;
}

/**
 * Resolves the *element* scalar of an array-typed field (only meaningful when
 * `isArrayType` is true). TS's emitted `design:type` metadata collapses every
 * array shape to the bare `Array` constructor, losing the element type - there is
 * no way to recover it from reflect-metadata alone. Instead this reads the entity's
 * `class-transformer` `@Type(() => X)` decorator (already required on array fields
 * for JSON deserialization elsewhere in this stack) via `class-transformer`'s own
 * `defaultMetadataStorage`, and maps the declared element constructor to a scalar.
 *
 * Falls back to `GraphQLString` when the field has no `@Type()` decorator, or its
 * `typeFunction()` doesn't resolve to `String`/`Number`/`Boolean` - preserving the
 * previous always-String behavior for anything not opted in.
 *
 * This depends on `entityType` resolving through the *same* installed copy of
 * `class-transformer` the entity's own `@Type()` decorator ran against - metadata
 * lives in a module-scoped singleton (`defaultMetadataStorage`), not a global, so a
 * duplicated/un-hoisted `class-transformer` install would silently fall back to the
 * String default rather than throwing.
 */
export function arrayElementGraphQLType(entityType: (new (...args: unknown[]) => unknown) | undefined, fieldName: string): GraphQLScalarType {
  const elementCtor = entityType ? defaultMetadataStorage.findTypeMetadata(entityType, fieldName)?.typeFunction() : undefined;
  switch (elementCtor) {
    case Number:
      return GraphQLFloat;
    case Boolean:
      return GraphQLBoolean;
    default:
      return GraphQLString;
  }
}
