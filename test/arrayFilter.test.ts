import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Type } from 'class-transformer';
import { Context, collection, decorators } from 'dblink';
import PostgreSql from 'dblink-pg';
import { QuerySetGraphQLHandler } from '../src/index.js';
import { pgConfig } from './setup.js';

const { Table, Column, Id } = decorators;

// No @Type() decorator on `tags` - exercises the fallback path (defaults the
// element scalar to GraphQLString/varchar[] when there's no @Type() metadata
// to resolve a more specific element type from).
@Table('gql_array_users')
class ArrayUser {
  @Id @Column('id') id: number = 0;
  @Column('name') name: string = '';
  @Column('tags') tags: string[] = [];
}

class ArrayAppContext extends Context {
  users = new collection.TableSet(ArrayUser);
}

// @Type()-decorated array fields of every supported element scalar - exercises
// the real class-transformer-metadata-driven resolution path (arrayElementGraphQLType).
@Table('gql_typed_array_users')
class TypedArrayUser {
  @Id @Column('id') id: number = 0;
  @Type(() => String) @Column('tags') tags: string[] = [];
  @Type(() => Number) @Column('scores') scores: number[] = [];
  @Type(() => Boolean) @Column('flags') flags: boolean[] = [];
}

class TypedArrayAppContext extends Context {
  users = new collection.TableSet(TypedArrayUser);
}

const pg = new PostgreSql(pgConfig);
let ctx: ArrayAppContext;
let handler: QuerySetGraphQLHandler<ArrayUser>;

// ══════════════════════════════════════════════════════════════════════════
// Array-typed field filtering (`overlap`/`contains`) — the `StringArrayFilter`
// schema dblink-graphql-frontend generates for a `string[]`-shaped column (e.g.
// a Postgres `varchar[]` column such as `tags`), and the query behavior behind
// it.
// ══════════════════════════════════════════════════════════════════════════

describe('array-typed field filtering (overlap/contains)', () => {
  beforeAll(async () => {
    await pg.init();
    await pg.run('DROP TABLE IF EXISTS gql_array_users');
    await pg.run(`
      CREATE TABLE gql_array_users (
        id   SERIAL PRIMARY KEY,
        name VARCHAR(100),
        tags VARCHAR(50)[]
      )
    `);
    await pg.run(`
      INSERT INTO gql_array_users (name, tags) VALUES
        ('Alice', ARRAY['vip','driver']),
        ('Bob',   ARRAY['driver']),
        ('Carol', ARRAY[]::varchar[])
    `);

    ctx = new ArrayAppContext(pg);
    await ctx.init();
    handler = new QuerySetGraphQLHandler(ctx.users, 'ArrayUser');
  });

  afterAll(async () => {
    await pg.run('DROP TABLE IF EXISTS gql_array_users');
  });

  it('introspection — tags is exposed as a String list, not a bare scalar', async () => {
    const result = await handler.execute(`{
      __type(name: "ArrayUser") { fields { name type { kind ofType { kind name } } } }
    }`);
    expect(result.errors).toBeUndefined();
    const fields = (result.data!.__type as { fields: { name: string; type: { kind: string; ofType: { kind: string; name: string } | null } }[] }).fields;
    const tagsField = fields.find(f => f.name === 'tags');
    expect(tagsField).toBeDefined();
    expect(tagsField!.type.kind).toBe('LIST');
    expect(tagsField!.type.ofType).toEqual({ kind: 'SCALAR', name: 'String' });
  });

  it('introspection — StringArrayFilter offers only overlap/contains/isNull (no scalar String ops)', async () => {
    const result = await handler.execute(`{
      __type(name: "StringArrayFilter") { inputFields { name } }
    }`);
    expect(result.errors).toBeUndefined();
    const ops = (result.data!.__type as { inputFields: { name: string }[] }).inputFields.map(f => f.name);
    expect(ops.sort()).toEqual(['contains', 'isNull', 'overlap']);
  });

  it('introspection — ArrayUserFilter.tags uses StringArrayFilter, not StringFilter', async () => {
    const result = await handler.execute(`{
      __type(name: "ArrayUserFilter") { inputFields { name type { name } } }
    }`);
    expect(result.errors).toBeUndefined();
    const fields = (result.data!.__type as { inputFields: { name: string; type: { name: string } }[] }).inputFields;
    const tagsFilter = fields.find(f => f.name === 'tags');
    expect(tagsFilter).toBeDefined();
    expect(tagsFilter!.type.name).toBe('StringArrayFilter');
  });

  it('list — overlap matches rows sharing at least one tag', async () => {
    const result = await handler.execute(`{ arrayUsers(filter: { tags: { overlap: ["vip"] } }) { name } }`);
    expect(result.errors).toBeUndefined();
    const rows = result.data!.arrayUsers as { name: string }[];
    expect(rows.map(r => r.name)).toEqual(['Alice']);
  });

  it('list — overlap with multiple candidates matches any row containing any of them', async () => {
    const result = await handler.execute(`{ arrayUsers(filter: { tags: { overlap: ["vip", "driver"] } }) { name } }`);
    expect(result.errors).toBeUndefined();
    const rows = result.data!.arrayUsers as { name: string }[];
    expect(rows.map(r => r.name).sort()).toEqual(['Alice', 'Bob']);
  });

  it('list — overlap with an empty list matches nothing', async () => {
    const result = await handler.execute(`{ arrayUsers(filter: { tags: { overlap: [] } }) { name } }`);
    expect(result.errors).toBeUndefined();
    expect(result.data!.arrayUsers as unknown[]).toHaveLength(0);
  });

  it('list — overlap ANDs with a sibling scalar filter', async () => {
    const result = await handler.execute(`{
      arrayUsers(filter: { name: { eq: "Bob" }, tags: { overlap: ["vip", "driver"] } }) { name }
    }`);
    expect(result.errors).toBeUndefined();
    const rows = result.data!.arrayUsers as { name: string }[];
    expect(rows.map(r => r.name)).toEqual(['Bob']);
  });

  it('list — contains matches rows whose tags are a superset of a single candidate', async () => {
    const result = await handler.execute(`{ arrayUsers(filter: { tags: { contains: ["driver"] } }) { name } }`);
    expect(result.errors).toBeUndefined();
    const rows = result.data!.arrayUsers as { name: string }[];
    expect(rows.map(r => r.name).sort()).toEqual(['Alice', 'Bob']);
  });

  it('list — contains with multiple candidates requires every one of them present', async () => {
    const result = await handler.execute(`{ arrayUsers(filter: { tags: { contains: ["vip", "driver"] } }) { name } }`);
    expect(result.errors).toBeUndefined();
    const rows = result.data!.arrayUsers as { name: string }[];
    expect(rows.map(r => r.name)).toEqual(['Alice']);
  });

  it('list — contains with an empty list matches every row (vacuously true)', async () => {
    const result = await handler.execute(`{ arrayUsers(filter: { tags: { contains: [] } }) { name } }`);
    expect(result.errors).toBeUndefined();
    const rows = result.data!.arrayUsers as { name: string }[];
    expect(rows).toHaveLength(3);
  });

  it('validation — like is not offered on an array-typed field', async () => {
    const result = await handler.execute(`{ arrayUsers(filter: { tags: { like: "%vip%" } }) { name } }`);
    expect(result.errors).toBeDefined();
  });

  it('list — tags round-trips through the object type as a list', async () => {
    const result = await handler.execute(`{
      arrayUsers(filter: { name: { eq: "Alice" } }) { name tags }
    }`);
    expect(result.errors).toBeUndefined();
    const rows = result.data!.arrayUsers as { name: string; tags: string[] }[];
    expect(rows[0].tags.sort()).toEqual(['driver', 'vip']);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// @Type()-driven element type resolution — proves the schema and the actual
// SQL cast (`numeric[]`/`boolean[]`, not always `varchar[]`) both follow the
// element type declared via class-transformer's @Type() decorator.
// ══════════════════════════════════════════════════════════════════════════

describe('array-typed field filtering — @Type()-resolved element scalars', () => {
  let typedCtx: TypedArrayAppContext;
  let typedHandler: QuerySetGraphQLHandler<TypedArrayUser>;

  beforeAll(async () => {
    // pg is already initialized by the first describe block's beforeAll above -
    // suites in this file run sequentially, and only the file-level afterAll
    // at the bottom closes the shared connection pool.
    await pg.run('DROP TABLE IF EXISTS gql_typed_array_users');
    await pg.run(`
      CREATE TABLE gql_typed_array_users (
        id     SERIAL PRIMARY KEY,
        tags   VARCHAR(50)[],
        scores NUMERIC[],
        flags  BOOLEAN[]
      )
    `);
    await pg.run(`
      INSERT INTO gql_typed_array_users (tags, scores, flags) VALUES
        (ARRAY['vip'],    ARRAY[1, 2],    ARRAY[true]),
        (ARRAY['driver'], ARRAY[3],       ARRAY[false]),
        (ARRAY[]::varchar[], ARRAY[]::numeric[], ARRAY[]::boolean[])
    `);

    typedCtx = new TypedArrayAppContext(pg);
    await typedCtx.init();
    typedHandler = new QuerySetGraphQLHandler(typedCtx.users, 'TypedArrayUser');
  });

  afterAll(async () => {
    await pg.run('DROP TABLE IF EXISTS gql_typed_array_users');
  });

  it('introspection — scores (@Type(() => Number)) resolves to a Float list backed by FloatArrayFilter', async () => {
    const typeResult = await typedHandler.execute(`{
      __type(name: "TypedArrayUser") { fields { name type { kind ofType { kind name } } } }
    }`);
    expect(typeResult.errors).toBeUndefined();
    const fields = (typeResult.data!.__type as { fields: { name: string; type: { kind: string; ofType: { kind: string; name: string } | null } }[] }).fields;
    expect(fields.find(f => f.name === 'scores')!.type).toEqual({ kind: 'LIST', ofType: { kind: 'SCALAR', name: 'Float' } });

    const filterResult = await typedHandler.execute(`{
      __type(name: "TypedArrayUserFilter") { inputFields { name type { name } } }
    }`);
    expect(filterResult.errors).toBeUndefined();
    const filterFields = (filterResult.data!.__type as { inputFields: { name: string; type: { name: string } }[] }).inputFields;
    expect(filterFields.find(f => f.name === 'scores')!.type.name).toBe('FloatArrayFilter');
  });

  it('introspection — flags (@Type(() => Boolean)) resolves to a Boolean list backed by BooleanArrayFilter', async () => {
    const typeResult = await typedHandler.execute(`{
      __type(name: "TypedArrayUser") { fields { name type { kind ofType { kind name } } } }
    }`);
    expect(typeResult.errors).toBeUndefined();
    const fields = (typeResult.data!.__type as { fields: { name: string; type: { kind: string; ofType: { kind: string; name: string } | null } }[] }).fields;
    expect(fields.find(f => f.name === 'flags')!.type).toEqual({ kind: 'LIST', ofType: { kind: 'SCALAR', name: 'Boolean' } });

    const filterResult = await typedHandler.execute(`{
      __type(name: "TypedArrayUserFilter") { inputFields { name type { name } } }
    }`);
    expect(filterResult.errors).toBeUndefined();
    const filterFields = (filterResult.data!.__type as { inputFields: { name: string; type: { name: string } }[] }).inputFields;
    expect(filterFields.find(f => f.name === 'flags')!.type.name).toBe('BooleanArrayFilter');
  });

  it('list — overlap on a numeric[] column casts to numeric[], not varchar[] (would 42883 against a real column otherwise)', async () => {
    const result = await typedHandler.execute(`{ typedArrayUsers(filter: { scores: { overlap: [2, 3] } }) { id scores } }`);
    expect(result.errors).toBeUndefined();
    const rows = result.data!.typedArrayUsers as { scores: number[] }[];
    expect(rows).toHaveLength(2);
  });

  it('list — overlap on a boolean[] column casts to boolean[]', async () => {
    const result = await typedHandler.execute(`{ typedArrayUsers(filter: { flags: { overlap: [true] } }) { id flags } }`);
    expect(result.errors).toBeUndefined();
    const rows = result.data!.typedArrayUsers as { flags: boolean[] }[];
    expect(rows).toHaveLength(1);
  });

  it('list — contains on a numeric[] column casts to numeric[], not varchar[]', async () => {
    const result = await typedHandler.execute(`{ typedArrayUsers(filter: { scores: { contains: [1, 2] } }) { id scores } }`);
    expect(result.errors).toBeUndefined();
    const rows = result.data!.typedArrayUsers as { scores: number[] }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].scores.sort()).toEqual([1, 2]);
  });

  it('list — overlap on the @Type(() => String) tags column still works alongside the other element types', async () => {
    const result = await typedHandler.execute(`{ typedArrayUsers(filter: { tags: { overlap: ["driver"] } }) { id tags } }`);
    expect(result.errors).toBeUndefined();
    const rows = result.data!.typedArrayUsers as { tags: string[] }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].tags).toEqual(['driver']);
  });
});

afterAll(async () => {
  await pg.connectionPool.end();
});
