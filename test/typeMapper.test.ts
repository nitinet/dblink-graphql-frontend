import { describe, expect, it } from 'vitest';
import { Type } from 'class-transformer';
import { GraphQLBoolean, GraphQLFloat, GraphQLID, GraphQLString } from 'graphql';
import { arrayElementGraphQLType, isArrayType, jsTypeToGraphQL } from '../src/typeMapper.js';

describe('jsTypeToGraphQL', () => {
  it('maps any primary-key field to GraphQLID, regardless of its data type', () => {
    expect(jsTypeToGraphQL(String, true)).toBe(GraphQLID);
    expect(jsTypeToGraphQL(Number, true)).toBe(GraphQLID);
    expect(jsTypeToGraphQL(Boolean, true)).toBe(GraphQLID);
  });

  it('maps String to GraphQLString', () => {
    expect(jsTypeToGraphQL(String, false)).toBe(GraphQLString);
  });

  it('maps Number to GraphQLFloat', () => {
    expect(jsTypeToGraphQL(Number, false)).toBe(GraphQLFloat);
  });

  it('maps Boolean to GraphQLBoolean', () => {
    expect(jsTypeToGraphQL(Boolean, false)).toBe(GraphQLBoolean);
  });

  it('falls back to GraphQLString for an unrecognized data type', () => {
    expect(jsTypeToGraphQL(Date, false)).toBe(GraphQLString);
    expect(jsTypeToGraphQL(undefined, false)).toBe(GraphQLString);
  });
});

describe('isArrayType', () => {
  it('is true for Array, false for scalar constructors', () => {
    expect(isArrayType(Array, false)).toBe(true);
    expect(isArrayType(String, false)).toBe(false);
    expect(isArrayType(Number, false)).toBe(false);
    expect(isArrayType(undefined, false)).toBe(false);
  });

  it('is always false for a primary key, even if its declared type is Array', () => {
    expect(isArrayType(Array, true)).toBe(false);
  });
});

describe('arrayElementGraphQLType', () => {
  // A plain class-transformer-decorated class - no dblink @Table/@Column needed,
  // since findTypeMetadata only keys off the class constructor + property name.
  class Entity {
    @Type(() => String) tags: string[] = [];
    @Type(() => Number) scores: number[] = [];
    @Type(() => Boolean) flags: boolean[] = [];
    // No @Type() decorator at all - the fallback case.
    untyped: string[] = [];
  }

  it('resolves GraphQLString for a @Type(() => String) array field', () => {
    expect(arrayElementGraphQLType(Entity, 'tags')).toBe(GraphQLString);
  });

  it('resolves GraphQLFloat for a @Type(() => Number) array field', () => {
    expect(arrayElementGraphQLType(Entity, 'scores')).toBe(GraphQLFloat);
  });

  it('resolves GraphQLBoolean for a @Type(() => Boolean) array field', () => {
    expect(arrayElementGraphQLType(Entity, 'flags')).toBe(GraphQLBoolean);
  });

  it('falls back to GraphQLString when the field has no @Type() decorator', () => {
    expect(arrayElementGraphQLType(Entity, 'untyped')).toBe(GraphQLString);
  });

  it('falls back to GraphQLString when entityType is undefined (e.g. unresolvable join field)', () => {
    expect(arrayElementGraphQLType(undefined, 'tags')).toBe(GraphQLString);
  });
});
