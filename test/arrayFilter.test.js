var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Type } from 'class-transformer';
import { Context, collection, decorators } from 'dblink';
import PostgreSql from 'dblink-pg';
import { QuerySetGraphQLHandler } from '../src/index.js';
import { pgConfig } from './setup.js';
const { Table, Column, Id } = decorators;
let ArrayUser = class ArrayUser {
    id = 0;
    name = '';
    tags = [];
};
__decorate([
    Id,
    Column('id'),
    __metadata("design:type", Number)
], ArrayUser.prototype, "id", void 0);
__decorate([
    Column('name'),
    __metadata("design:type", String)
], ArrayUser.prototype, "name", void 0);
__decorate([
    Column('tags'),
    __metadata("design:type", Array)
], ArrayUser.prototype, "tags", void 0);
ArrayUser = __decorate([
    Table('gql_array_users')
], ArrayUser);
class ArrayAppContext extends Context {
    users = new collection.TableSet(ArrayUser);
}
let TypedArrayUser = class TypedArrayUser {
    id = 0;
    tags = [];
    scores = [];
    flags = [];
};
__decorate([
    Id,
    Column('id'),
    __metadata("design:type", Number)
], TypedArrayUser.prototype, "id", void 0);
__decorate([
    Type(() => String),
    Column('tags'),
    __metadata("design:type", Array)
], TypedArrayUser.prototype, "tags", void 0);
__decorate([
    Type(() => Number),
    Column('scores'),
    __metadata("design:type", Array)
], TypedArrayUser.prototype, "scores", void 0);
__decorate([
    Type(() => Boolean),
    Column('flags'),
    __metadata("design:type", Array)
], TypedArrayUser.prototype, "flags", void 0);
TypedArrayUser = __decorate([
    Table('gql_typed_array_users')
], TypedArrayUser);
class TypedArrayAppContext extends Context {
    users = new collection.TableSet(TypedArrayUser);
}
const pg = new PostgreSql(pgConfig);
let ctx;
let handler;
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
        const fields = result.data.__type.fields;
        const tagsField = fields.find(f => f.name === 'tags');
        expect(tagsField).toBeDefined();
        expect(tagsField.type.kind).toBe('LIST');
        expect(tagsField.type.ofType).toEqual({ kind: 'SCALAR', name: 'String' });
    });
    it('introspection — StringArrayFilter offers only overlap/contains/isNull (no scalar String ops)', async () => {
        const result = await handler.execute(`{
      __type(name: "StringArrayFilter") { inputFields { name } }
    }`);
        expect(result.errors).toBeUndefined();
        const ops = result.data.__type.inputFields.map(f => f.name);
        expect(ops.sort()).toEqual(['contains', 'isNull', 'overlap']);
    });
    it('introspection — ArrayUserFilter.tags uses StringArrayFilter, not StringFilter', async () => {
        const result = await handler.execute(`{
      __type(name: "ArrayUserFilter") { inputFields { name type { name } } }
    }`);
        expect(result.errors).toBeUndefined();
        const fields = result.data.__type.inputFields;
        const tagsFilter = fields.find(f => f.name === 'tags');
        expect(tagsFilter).toBeDefined();
        expect(tagsFilter.type.name).toBe('StringArrayFilter');
    });
    it('list — overlap matches rows sharing at least one tag', async () => {
        const result = await handler.execute(`{ arrayUsers(filter: { tags: { overlap: ["vip"] } }) { name } }`);
        expect(result.errors).toBeUndefined();
        const rows = result.data.arrayUsers;
        expect(rows.map(r => r.name)).toEqual(['Alice']);
    });
    it('list — overlap with multiple candidates matches any row containing any of them', async () => {
        const result = await handler.execute(`{ arrayUsers(filter: { tags: { overlap: ["vip", "driver"] } }) { name } }`);
        expect(result.errors).toBeUndefined();
        const rows = result.data.arrayUsers;
        expect(rows.map(r => r.name).sort()).toEqual(['Alice', 'Bob']);
    });
    it('list — overlap with an empty list matches nothing', async () => {
        const result = await handler.execute(`{ arrayUsers(filter: { tags: { overlap: [] } }) { name } }`);
        expect(result.errors).toBeUndefined();
        expect(result.data.arrayUsers).toHaveLength(0);
    });
    it('list — overlap ANDs with a sibling scalar filter', async () => {
        const result = await handler.execute(`{
      arrayUsers(filter: { name: { eq: "Bob" }, tags: { overlap: ["vip", "driver"] } }) { name }
    }`);
        expect(result.errors).toBeUndefined();
        const rows = result.data.arrayUsers;
        expect(rows.map(r => r.name)).toEqual(['Bob']);
    });
    it('list — contains matches rows whose tags are a superset of a single candidate', async () => {
        const result = await handler.execute(`{ arrayUsers(filter: { tags: { contains: ["driver"] } }) { name } }`);
        expect(result.errors).toBeUndefined();
        const rows = result.data.arrayUsers;
        expect(rows.map(r => r.name).sort()).toEqual(['Alice', 'Bob']);
    });
    it('list — contains with multiple candidates requires every one of them present', async () => {
        const result = await handler.execute(`{ arrayUsers(filter: { tags: { contains: ["vip", "driver"] } }) { name } }`);
        expect(result.errors).toBeUndefined();
        const rows = result.data.arrayUsers;
        expect(rows.map(r => r.name)).toEqual(['Alice']);
    });
    it('list — contains with an empty list matches every row (vacuously true)', async () => {
        const result = await handler.execute(`{ arrayUsers(filter: { tags: { contains: [] } }) { name } }`);
        expect(result.errors).toBeUndefined();
        const rows = result.data.arrayUsers;
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
        const rows = result.data.arrayUsers;
        expect(rows[0].tags.sort()).toEqual(['driver', 'vip']);
    });
});
describe('array-typed field filtering — @Type()-resolved element scalars', () => {
    let typedCtx;
    let typedHandler;
    beforeAll(async () => {
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
        const fields = typeResult.data.__type.fields;
        expect(fields.find(f => f.name === 'scores').type).toEqual({ kind: 'LIST', ofType: { kind: 'SCALAR', name: 'Float' } });
        const filterResult = await typedHandler.execute(`{
      __type(name: "TypedArrayUserFilter") { inputFields { name type { name } } }
    }`);
        expect(filterResult.errors).toBeUndefined();
        const filterFields = filterResult.data.__type.inputFields;
        expect(filterFields.find(f => f.name === 'scores').type.name).toBe('FloatArrayFilter');
    });
    it('introspection — flags (@Type(() => Boolean)) resolves to a Boolean list backed by BooleanArrayFilter', async () => {
        const typeResult = await typedHandler.execute(`{
      __type(name: "TypedArrayUser") { fields { name type { kind ofType { kind name } } } }
    }`);
        expect(typeResult.errors).toBeUndefined();
        const fields = typeResult.data.__type.fields;
        expect(fields.find(f => f.name === 'flags').type).toEqual({ kind: 'LIST', ofType: { kind: 'SCALAR', name: 'Boolean' } });
        const filterResult = await typedHandler.execute(`{
      __type(name: "TypedArrayUserFilter") { inputFields { name type { name } } }
    }`);
        expect(filterResult.errors).toBeUndefined();
        const filterFields = filterResult.data.__type.inputFields;
        expect(filterFields.find(f => f.name === 'flags').type.name).toBe('BooleanArrayFilter');
    });
    it('list — overlap on a numeric[] column casts to numeric[], not varchar[] (would 42883 against a real column otherwise)', async () => {
        const result = await typedHandler.execute(`{ typedArrayUsers(filter: { scores: { overlap: [2, 3] } }) { id scores } }`);
        expect(result.errors).toBeUndefined();
        const rows = result.data.typedArrayUsers;
        expect(rows).toHaveLength(2);
    });
    it('list — overlap on a boolean[] column casts to boolean[]', async () => {
        const result = await typedHandler.execute(`{ typedArrayUsers(filter: { flags: { overlap: [true] } }) { id flags } }`);
        expect(result.errors).toBeUndefined();
        const rows = result.data.typedArrayUsers;
        expect(rows).toHaveLength(1);
    });
    it('list — contains on a numeric[] column casts to numeric[], not varchar[]', async () => {
        const result = await typedHandler.execute(`{ typedArrayUsers(filter: { scores: { contains: [1, 2] } }) { id scores } }`);
        expect(result.errors).toBeUndefined();
        const rows = result.data.typedArrayUsers;
        expect(rows).toHaveLength(1);
        expect(rows[0].scores.sort()).toEqual([1, 2]);
    });
    it('list — overlap on the @Type(() => String) tags column still works alongside the other element types', async () => {
        const result = await typedHandler.execute(`{ typedArrayUsers(filter: { tags: { overlap: ["driver"] } }) { id tags } }`);
        expect(result.errors).toBeUndefined();
        const rows = result.data.typedArrayUsers;
        expect(rows).toHaveLength(1);
        expect(rows[0].tags).toEqual(['driver']);
    });
});
afterAll(async () => {
    await pg.connectionPool.end();
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXJyYXlGaWx0ZXIudGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImFycmF5RmlsdGVyLnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7O0FBQUEsT0FBTyxFQUFFLFFBQVEsRUFBRSxTQUFTLEVBQUUsUUFBUSxFQUFFLE1BQU0sRUFBRSxFQUFFLEVBQUUsTUFBTSxRQUFRLENBQUM7QUFDbkUsT0FBTyxFQUFFLElBQUksRUFBRSxNQUFNLG1CQUFtQixDQUFDO0FBQ3pDLE9BQU8sRUFBRSxPQUFPLEVBQUUsVUFBVSxFQUFFLFVBQVUsRUFBRSxNQUFNLFFBQVEsQ0FBQztBQUN6RCxPQUFPLFVBQVUsTUFBTSxXQUFXLENBQUM7QUFDbkMsT0FBTyxFQUFFLHNCQUFzQixFQUFFLE1BQU0saUJBQWlCLENBQUM7QUFDekQsT0FBTyxFQUFFLFFBQVEsRUFBRSxNQUFNLFlBQVksQ0FBQztBQUV0QyxNQUFNLEVBQUUsS0FBSyxFQUFFLE1BQU0sRUFBRSxFQUFFLEVBQUUsR0FBRyxVQUFVLENBQUM7QUFNekMsSUFBTSxTQUFTLEdBQWYsTUFBTSxTQUFTO0lBQ0ssRUFBRSxHQUFXLENBQUMsQ0FBQztJQUNqQixJQUFJLEdBQVcsRUFBRSxDQUFDO0lBQ2xCLElBQUksR0FBYSxFQUFFLENBQUM7Q0FDckMsQ0FBQTtBQUhtQjtJQUFqQixFQUFFO0lBQUUsTUFBTSxDQUFDLElBQUksQ0FBQzs7cUNBQWdCO0FBQ2pCO0lBQWYsTUFBTSxDQUFDLE1BQU0sQ0FBQzs7dUNBQW1CO0FBQ2xCO0lBQWYsTUFBTSxDQUFDLE1BQU0sQ0FBQzs7dUNBQXFCO0FBSGhDLFNBQVM7SUFEZCxLQUFLLENBQUMsaUJBQWlCLENBQUM7R0FDbkIsU0FBUyxDQUlkO0FBRUQsTUFBTSxlQUFnQixTQUFRLE9BQU87SUFDbkMsS0FBSyxHQUFHLElBQUksVUFBVSxDQUFDLFFBQVEsQ0FBQyxTQUFTLENBQUMsQ0FBQztDQUM1QztBQUtELElBQU0sY0FBYyxHQUFwQixNQUFN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