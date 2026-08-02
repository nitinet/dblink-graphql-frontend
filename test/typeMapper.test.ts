import { describe, expect, it } from 'vitest';
import { GraphQLBoolean, GraphQLFloat, GraphQLID, GraphQLString } from 'graphql';
import { jsTypeToGraphQL } from '../src/typeMapper.js';

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
