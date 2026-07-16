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
