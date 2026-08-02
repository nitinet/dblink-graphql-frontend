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
import { Context, collection, core, decorators } from 'dblink';
import PostgreSql from 'dblink-pg';
import { QuerySetGraphQLHandler } from '../src/index.js';
import { pgConfig } from './setup.js';
import { createAppContext, createOrderEntity, createUserEntity } from './models.js';
const { Table, Column, Id } = decorators;
const User = createUserEntity('gql_test_users');
const Order = createOrderEntity('orders_gql_test');
const AppContext = createAppContext(User, Order);
const pg = new PostgreSql(pgConfig);
let ctx;
async function setupDb() {
    await pg.run('DROP TABLE IF EXISTS gql_test_users');
    await pg.run(`
    CREATE TABLE gql_test_users (
      id    SERIAL PRIMARY KEY,
      name  VARCHAR(100),
      email VARCHAR(100)
    )
  `);
    await pg.run(`
    INSERT INTO gql_test_users (name, email) VALUES
      ('Alice', 'alice@example.com'),
      ('Bob',   'bob@example.com')
  `);
}
async function setupOrdersDb() {
    await pg.run('DROP TABLE IF EXISTS orders_gql_test');
    await pg.run(`
    CREATE TABLE orders_gql_test (
      order_id SERIAL PRIMARY KEY,
      user_id  INT NOT NULL,
      amount   NUMERIC(10,2) NOT NULL
    )
  `);
    await pg.run(`
    INSERT INTO orders_gql_test (user_id, amount) VALUES
      (1, 100.00),
      (1, 200.00),
      (2, 300.00)
  `);
}
async function ensureCtx() {
    if (ctx)
        return;
    await pg.init();
    await setupDb();
    ctx = new AppContext(pg);
    await ctx.init();
}
describe('QuerySetGraphQLHandler — full TableSet (dblink-pg)', () => {
    let handler;
    beforeAll(async () => {
        await pg.init();
        await setupDb();
        ctx = new AppContext(pg);
        await ctx.init();
        handler = new QuerySetGraphQLHandler(ctx.users, 'User');
    });
    it('introspection — schema query type is Query', async () => {
        const result = await handler.execute(`{
      __schema { queryType { name } }
    }`);
        expect(result.errors).toBeUndefined();
        expect(result.data.__schema.queryType.name).toBe('Query');
    });
    it('introspection — User, UserFilter, UserList, OrderDirection types present', async () => {
        const result = await handler.execute(`{
      __schema { types { name kind } }
    }`);
        expect(result.errors).toBeUndefined();
        const names = result.data.__schema.types.map(t => t.name);
        expect(names).toContain('User');
        expect(names).toContain('UserFilter');
        expect(names).toContain('UserList');
        expect(names).toContain('OrderDirection');
    });
    it('introspection — User type has id, name, email fields', async () => {
        const result = await handler.execute(`{
      __type(name: "User") { fields { name } }
    }`);
        expect(result.errors).toBeUndefined();
        const fields = result.data.__type.fields.map(f => f.name);
        expect(fields).toContain('id');
        expect(fields).toContain('name');
        expect(fields).toContain('email');
    });
    it('introspection — StringFilter offers eq/neq/like/in/notIn/isNull (no between)', async () => {
        const result = await handler.execute(`{
      __type(name: "StringFilter") { inputFields { name } }
    }`);
        expect(result.errors).toBeUndefined();
        const ops = result.data.__type.inputFields.map(f => f.name);
        expect(ops.sort()).toEqual(['eq', 'in', 'isNull', 'like', 'neq', 'notIn']);
    });
    it('introspection — IDFilter offers eq/neq/in/notIn/isNull (no like, no ordering, no between) — same shape as BooleanFilter', async () => {
        const result = await handler.execute(`{
      __type(name: "IDFilter") { inputFields { name } }
    }`);
        expect(result.errors).toBeUndefined();
        const ops = result.data.__type.inputFields.map(f => f.name);
        expect(ops.sort()).toEqual(['eq', 'in', 'isNull', 'neq', 'notIn']);
    });
    it('introspection — UserFilter has a self-referential or field', async () => {
        const result = await handler.execute(`{
      __type(name: "UserFilter") { inputFields { name type { kind ofType { kind name } } } }
    }`);
        expect(result.errors).toBeUndefined();
        const fields = result.data.__type.inputFields;
        const orField = fields.find(f => f.name === 'or');
        expect(orField).toBeDefined();
        expect(orField.type.kind).toBe('LIST');
    });
    it('introspection — Query has users, usersCount, usersList fields', async () => {
        const result = await handler.execute(`{
      __type(name: "Query") { fields { name } }
    }`);
        expect(result.errors).toBeUndefined();
        const fields = result.data.__type.fields.map(f => f.name);
        expect(fields).toContain('users');
        expect(fields).toContain('usersCount');
        expect(fields).toContain('usersList');
    });
    it('list — returns all rows', async () => {
        const result = await handler.execute(`{ users { id name email } }`);
        expect(result.errors).toBeUndefined();
        const rows = result.data.users;
        expect(rows).toHaveLength(2);
        const names = rows.map(r => r.name);
        expect(names).toContain('Alice');
        expect(names).toContain('Bob');
    });
    it('list — filter arg narrows results (eq)', async () => {
        const result = await handler.execute(`{
      users(filter: { name: { eq: "Alice" } }) { id name email }
    }`);
        expect(result.errors).toBeUndefined();
        const rows = result.data.users;
        expect(rows).toHaveLength(1);
        expect(rows[0].name).toBe('Alice');
        expect(rows[0].email).toBe('alice@example.com');
    });
    it('list — filter neq excludes a match', async () => {
        const result = await handler.execute(`{
      users(filter: { name: { neq: "Alice" } }) { name }
    }`);
        expect(result.errors).toBeUndefined();
        const rows = result.data.users;
        expect(rows.map(r => r.name)).toEqual(['Bob']);
    });
    it('list — filter like matches a pattern', async () => {
        const result = await handler.execute(`{
      users(filter: { email: { like: "%example.com" } }) { name }
    }`);
        expect(result.errors).toBeUndefined();
        const rows = result.data.users;
        expect(rows).toHaveLength(2);
    });
    it('validation — bare scalar filter shape is rejected', async () => {
        const result = await handler.execute(`{
      users(filter: { name: "Alice" }) { name }
    }`);
        expect(result.errors).toBeDefined();
        expect(result.errors.length).toBeGreaterThan(0);
    });
    it('list — filter in matches a set of values', async () => {
        const result = await handler.execute(`{
      users(filter: { name: { in: ["Alice", "Nobody"] } }) { name }
    }`);
        expect(result.errors).toBeUndefined();
        const rows = result.data.users;
        expect(rows.map(r => r.name)).toEqual(['Alice']);
    });
    it('list — filter notIn excludes a set of values', async () => {
        const result = await handler.execute(`{
      users(filter: { name: { notIn: ["Alice"] } }) { name }
    }`);
        expect(result.errors).toBeUndefined();
        const rows = result.data.users;
        expect(rows.map(r => r.name)).toEqual(['Bob']);
    });
    it('list — or combinator matches either branch', async () => {
        const result = await handler.execute(`{
      users(filter: { or: [{ name: { eq: "Alice" } }, { name: { eq: "Bob" } }] }) { name }
    }`);
        expect(result.errors).toBeUndefined();
        const rows = result.data.users;
        expect(rows.map(r => r.name).sort()).toEqual(['Alice', 'Bob']);
    });
    it('list — or combinator ANDs with a sibling direct-field filter', async () => {
        const result = await handler.execute(`{
      users(filter: { email: { like: "%example.com" }, or: [{ name: { eq: "Alice" } }, { name: { eq: "Nobody" } }] }) { name }
    }`);
        expect(result.errors).toBeUndefined();
        const rows = result.data.users;
        expect(rows.map(r => r.name)).toEqual(['Alice']);
    });
    it('list — orderBy DESC', async () => {
        const result = await handler.execute(`{
      users(orderBy: { field: "name", direction: DESC }) { name }
    }`);
        expect(result.errors).toBeUndefined();
        const rows = result.data.users;
        expect(rows[0].name).toBe('Bob');
        expect(rows[1].name).toBe('Alice');
    });
    it('list — limit restricts row count', async () => {
        const result = await handler.execute(`{ users(limit: 1) { name } }`);
        expect(result.errors).toBeUndefined();
        expect(result.data.users.length).toBe(1);
    });
    it('count — returns total row count', async () => {
        const result = await handler.execute(`{ usersCount }`);
        expect(result.errors).toBeUndefined();
        expect(result.data.usersCount).toBe(2);
    });
    it('count — respects filter', async () => {
        const result = await handler.execute(`{
      usersCount(filter: { name: { eq: "Alice" } })
    }`);
        expect(result.errors).toBeUndefined();
        expect(result.data.usersCount).toBe(1);
    });
    it('list result — returns count + values together', async () => {
        const result = await handler.execute(`{
      usersList { count values { name } }
    }`);
        expect(result.errors).toBeUndefined();
        const list = result.data.usersList;
        expect(list.count).toBe(2);
        expect(list.values).toHaveLength(2);
    });
    it('list result — count ignores limit (reflects the total, not the page)', async () => {
        const result = await handler.execute(`{
      usersList(limit: 1) { count values { name } }
    }`);
        expect(result.errors).toBeUndefined();
        const list = result.data.usersList;
        expect(list.count).toBe(2);
        expect(list.values).toHaveLength(1);
    });
    it('list result — count ignores offset', async () => {
        const result = await handler.execute(`{
      usersList(offset: 1, limit: 1) { count values { name } }
    }`);
        expect(result.errors).toBeUndefined();
        const list = result.data.usersList;
        expect(list.count).toBe(2);
        expect(list.values).toHaveLength(1);
    });
    it('list result — count reflects the filtered total, not just the page', async () => {
        const result = await handler.execute(`{
      usersList(filter: { email: { like: "%example.com" } }, limit: 1) { count values { name } }
    }`);
        expect(result.errors).toBeUndefined();
        const list = result.data.usersList;
        expect(list.count).toBe(2);
        expect(list.values).toHaveLength(1);
    });
    it('validation — unknown field returns GraphQL error', async () => {
        const result = await handler.execute(`{ users { nonExistentField } }`);
        expect(result.errors).toBeDefined();
        expect(result.errors.length).toBeGreaterThan(0);
    });
    it('multiple requests do not accumulate filter state', async () => {
        await handler.execute(`{ users(filter: { name: { eq: "Alice" } }) { name } }`);
        const result = await handler.execute(`{ users { name } }`);
        expect(result.errors).toBeUndefined();
        expect(result.data.users.length).toBe(2);
    });
});
describe('QuerySetGraphQLHandler — select()-narrowed QuerySet (dblink-pg)', () => {
    let handler;
    beforeAll(async () => {
        await ensureCtx();
        handler = new QuerySetGraphQLHandler(ctx.users.select(['id', 'name']), 'UserSummary');
    });
    it('introspection — only selected fields appear on the type', async () => {
        const result = await handler.execute(`{
      __type(name: "UserSummary") { fields { name } }
    }`);
        expect(result.errors).toBeUndefined();
        const fields = result.data.__type.fields.map(f => f.name);
        expect(fields).toContain('id');
        expect(fields).toContain('name');
        expect(fields).not.toContain('email');
    });
    it('list — returns only selected columns', async () => {
        const result = await handler.execute(`{ userSummarys { id name } }`);
        expect(result.errors).toBeUndefined();
        const rows = result.data.userSummarys;
        expect(rows).toHaveLength(2);
    });
    it('validation — querying a non-selected field is a GQL error', async () => {
        const result = await handler.execute(`{ userSummarys { email } }`);
        expect(result.errors).toBeDefined();
    });
});
describe('QuerySetGraphQLHandler — pre-filtered QuerySet (dblink-pg)', () => {
    let handler;
    beforeAll(async () => {
        await ensureCtx();
        const aliceOnly = ctx.users.where(eb => eb.eq('name', 'Alice'));
        handler = new QuerySetGraphQLHandler(aliceOnly, 'AliceUser');
    });
    it('list — base filter restricts results regardless of GQL args', async () => {
        const result = await handler.execute(`{ aliceUsers { name } }`);
        expect(result.errors).toBeUndefined();
        const rows = result.data.aliceUsers;
        expect(rows.every(r => r.name === 'Alice')).toBe(true);
    });
    it('count — reflects base filter', async () => {
        const result = await handler.execute(`{ aliceUsersCount }`);
        expect(result.errors).toBeUndefined();
        expect(result.data.aliceUsersCount).toBe(1);
    });
});
describe('QuerySetGraphQLHandler — JoinQuerySet (dblink-pg)', () => {
    let handler;
    beforeAll(async () => {
        await ensureCtx();
        await setupOrdersDb();
        const joinQS = ctx.users.join(ctx.orders, (u, o) => u.eq('id', o.col('userId')));
        handler = new QuerySetGraphQLHandler(joinQS, 'UserOrder');
    });
    it('introspection — schema query type is Query', async () => {
        const result = await handler.execute(`{ __schema { queryType { name } } }`);
        expect(result.errors).toBeUndefined();
        expect(result.data.__schema.queryType.name).toBe('Query');
    });
    it('introspection — UserOrder, UserOrderFilter, UserOrderList types present', async () => {
        const result = await handler.execute(`{ __schema { types { name } } }`);
        expect(result.errors).toBeUndefined();
        const names = result.data.__schema.types.map(t => t.name);
        expect(names).toContain('UserOrder');
        expect(names).toContain('UserOrderFilter');
        expect(names).toContain('UserOrderList');
    });
    it('introspection — UserOrder type exposes combined fields', async () => {
        const result = await handler.execute(`{ __type(name: "UserOrder") { fields { name } } }`);
        expect(result.errors).toBeUndefined();
        const fields = result.data.__type.fields.map(f => f.name);
        expect(fields).toContain('id');
        expect(fields).toContain('name');
        expect(fields).toContain('email');
        expect(fields).toContain('orderId');
        expect(fields).toContain('userId');
        expect(fields).toContain('amount');
    });
    it('introspection — Query has userOrders, userOrdersCount, userOrdersList', async () => {
        const result = await handler.execute(`{ __type(name: "Query") { fields { name } } }`);
        expect(result.errors).toBeUndefined();
        const fields = result.data.__type.fields.map(f => f.name);
        expect(fields).toContain('userOrders');
        expect(fields).toContain('userOrdersCount');
        expect(fields).toContain('userOrdersList');
    });
    it('list — returns all joined rows (3 total: 2 for Alice, 1 for Bob)', async () => {
        const result = await handler.execute(`{ userOrders { name amount } }`);
        expect(result.errors).toBeUndefined();
        const rows = result.data.userOrders;
        expect(rows).toHaveLength(3);
        const names = rows.map(r => r.name);
        expect(names.filter(n => n === 'Alice')).toHaveLength(2);
        expect(names.filter(n => n === 'Bob')).toHaveLength(1);
    });
    it('list — filter on joined field (name from left table)', async () => {
        const result = await handler.execute(`{
      userOrders(filter: { name: { eq: "Alice" } }) { name amount }
    }`);
        expect(result.errors).toBeUndefined();
        const rows = result.data.userOrders;
        expect(rows).toHaveLength(2);
        expect(rows.every(r => r.name === 'Alice')).toBe(true);
    });
    it('list — filter gt/gte/lt/lte narrow a numeric (Float) field', async () => {
        const gt = await handler.execute(`{ userOrders(filter: { amount: { gt: 150 } }) { amount } }`);
        expect(gt.errors).toBeUndefined();
        expect(gt.data.userOrders.map(r => Number(r.amount)).sort()).toEqual([200, 300]);
        const gte = await handler.execute(`{ userOrders(filter: { amount: { gte: 200 } }) { amount } }`);
        expect(gte.errors).toBeUndefined();
        expect(gte.data.userOrders.map(r => Number(r.amount)).sort()).toEqual([200, 300]);
        const lt = await handler.execute(`{ userOrders(filter: { amount: { lt: 200 } }) { amount } }`);
        expect(lt.errors).toBeUndefined();
        expect(lt.data.userOrders.map(r => Number(r.amount))).toEqual([100]);
        const lte = await handler.execute(`{ userOrders(filter: { amount: { lte: 100 } }) { amount } }`);
        expect(lte.errors).toBeUndefined();
        expect(lte.data.userOrders.map(r => Number(r.amount))).toEqual([100]);
    });
    it('list — filter neq excludes a numeric match', async () => {
        const result = await handler.execute(`{ userOrders(filter: { amount: { neq: 300 } }) { amount } }`);
        expect(result.errors).toBeUndefined();
        expect(result.data.userOrders.map(r => Number(r.amount)).sort()).toEqual([100, 200]);
    });
    it('list — multiple operators on one field AND together (range)', async () => {
        const result = await handler.execute(`{
      userOrders(filter: { amount: { gte: 150, lte: 250 } }) { name amount }
    }`);
        expect(result.errors).toBeUndefined();
        const rows = result.data.userOrders;
        expect(rows).toHaveLength(1);
        expect(Number(rows[0].amount)).toBe(200);
    });
    it('validation — FloatFilter does not offer like', async () => {
        const result = await handler.execute(`{
      userOrders(filter: { amount: { like: "2%" } }) { amount }
    }`);
        expect(result.errors).toBeDefined();
    });
    it('introspection — FloatFilter offers the full numeric operator set including in/notIn/between/isNull', async () => {
        const result = await handler.execute(`{
      __type(name: "FloatFilter") { inputFields { name } }
    }`);
        expect(result.errors).toBeUndefined();
        const ops = result.data.__type.inputFields.map(f => f.name);
        expect(ops.sort()).toEqual(['between', 'eq', 'gt', 'gte', 'in', 'isNull', 'lt', 'lte', 'neq', 'notIn']);
    });
    it('list — filter in matches a numeric set', async () => {
        const result = await handler.execute(`{ userOrders(filter: { amount: { in: [100, 300] } }) { amount } }`);
        expect(result.errors).toBeUndefined();
        expect(result.data.userOrders.map(r => Number(r.amount)).sort()).toEqual([100, 300]);
    });
    it('list — filter notIn excludes a numeric set', async () => {
        const result = await handler.execute(`{ userOrders(filter: { amount: { notIn: [100] } }) { amount } }`);
        expect(result.errors).toBeUndefined();
        expect(result.data.userOrders.map(r => Number(r.amount)).sort()).toEqual([200, 300]);
    });
    it('list — filter isNull on a NOT NULL numeric column matches nothing', async () => {
        const isNullTrue = await handler.execute(`{ userOrders(filter: { amount: { isNull: true } }) { amount } }`);
        expect(isNullTrue.errors).toBeUndefined();
        expect(isNullTrue.data.userOrders.length).toBe(0);
        const isNullFalse = await handler.execute(`{ userOrders(filter: { amount: { isNull: false } }) { amount } }`);
        expect(isNullFalse.errors).toBeUndefined();
        expect(isNullFalse.data.userOrders.length).toBe(3);
    });
    it('list — filter between narrows a numeric range', async () => {
        const result = await handler.execute(`{ userOrders(filter: { amount: { between: { from: 150, to: 250 } } }) { amount } }`);
        expect(result.errors).toBeUndefined();
        expect(result.data.userOrders.map(r => Number(r.amount))).toEqual([200]);
    });
    it('list — nested or (an or branch containing its own or)', async () => {
        const result = await handler.execute(`{
      userOrders(filter: { or: [{ amount: { eq: 100 } }, { or: [{ amount: { eq: 200 } }, { amount: { eq: 300 } }] }] }) { amount }
    }`);
        expect(result.errors).toBeUndefined();
        expect(result.data.userOrders.map(r => Number(r.amount)).sort()).toEqual([100, 200, 300]);
    });
    it('list — or combinator ANDs with a sibling direct-field filter on a join', async () => {
        const result = await handler.execute(`{
      userOrders(filter: { name: { eq: "Alice" }, or: [{ amount: { eq: 100 } }, { amount: { eq: 300 } }] }) { name amount }
    }`);
        expect(result.errors).toBeUndefined();
        const rows = result.data.userOrders;
        expect(rows).toHaveLength(1);
        expect(rows[0].name).toBe('Alice');
        expect(Number(rows[0].amount)).toBe(100);
    });
    it('list — orderBy amount DESC', async () => {
        const result = await handler.execute(`{
      userOrders(orderBy: { field: "amount", direction: DESC }) { name amount }
    }`);
        expect(result.errors).toBeUndefined();
        const rows = result.data.userOrders;
        expect(Number(rows[0].amount)).toBe(300);
        expect(Number(rows[rows.length - 1].amount)).toBe(100);
    });
    it('list — limit restricts row count', async () => {
        const result = await handler.execute(`{ userOrders(limit: 2) { name } }`);
        expect(result.errors).toBeUndefined();
        expect(result.data.userOrders.length).toBe(2);
    });
    it('count — returns total joined row count', async () => {
        const result = await handler.execute(`{ userOrdersCount }`);
        expect(result.errors).toBeUndefined();
        expect(result.data.userOrdersCount).toBe(3);
    });
    it('count — respects filter on joined field', async () => {
        const result = await handler.execute(`{
      userOrdersCount(filter: { name: { eq: "Alice" } })
    }`);
        expect(result.errors).toBeUndefined();
        expect(result.data.userOrdersCount).toBe(2);
    });
    it('list result — returns count + values together', async () => {
        const result = await handler.execute(`{
      userOrdersList { count values { name amount } }
    }`);
        expect(result.errors).toBeUndefined();
        const list = result.data.userOrdersList;
        expect(list.count).toBe(3);
        expect(list.values).toHaveLength(3);
    });
    it('list result — count ignores limit/offset on a JoinQuerySet', async () => {
        const result = await handler.execute(`{
      userOrdersList(limit: 1, offset: 1) { count values { name amount } }
    }`);
        expect(result.errors).toBeUndefined();
        const list = result.data.userOrdersList;
        expect(list.count).toBe(3);
        expect(list.values).toHaveLength(1);
    });
    it('multiple requests do not accumulate filter state', async () => {
        await handler.execute(`{ userOrders(filter: { name: { eq: "Alice" } }) { name } }`);
        const result = await handler.execute(`{ userOrders { name } }`);
        expect(result.errors).toBeUndefined();
        expect(result.data.userOrders.length).toBe(3);
    });
});
describe('QuerySetGraphQLHandler — LeftJoin (dblink-pg)', () => {
    let handler;
    beforeAll(async () => {
        await ensureCtx();
        await setupOrdersDb();
        await pg.run(`INSERT INTO gql_test_users (name, email) VALUES ('Carol', 'carol@example.com')`);
        const leftJoinQS = ctx.users.join(ctx.orders, (u, o) => u.eq('id', o.col('userId')), core.sql.types.Join.LeftJoin);
        handler = new QuerySetGraphQLHandler(leftJoinQS, 'UserOrderLeft');
    });
    it('list — includes the user with no matching orders, with null order fields', async () => {
        const result = await handler.execute(`{ userOrderLefts { name orderId amount } }`);
        expect(result.errors).toBeUndefined();
        const rows = result.data.userOrderLefts;
        expect(rows).toHaveLength(4);
        const carolRow = rows.find(r => r.name === 'Carol');
        expect(carolRow).toBeDefined();
        expect(carolRow.orderId).toBeNull();
        expect(carolRow.amount).toBeNull();
    });
    it('count — includes the null-filled row for the unmatched user', async () => {
        const result = await handler.execute(`{ userOrderLeftsCount }`);
        expect(result.errors).toBeUndefined();
        expect(result.data.userOrderLeftsCount).toBe(4);
    });
});
describe('QuerySetGraphQLHandler — select()-narrowed JoinQuerySet (dblink-pg)', () => {
    let handler;
    beforeAll(async () => {
        await ensureCtx();
        await setupOrdersDb();
        const narrowedJoin = ctx.users.join(ctx.orders, (u, o) => u.eq('id', o.col('userId'))).select(['name', 'amount']);
        handler = new QuerySetGraphQLHandler(narrowedJoin, 'UserOrderSummary');
    });
    it('introspection — only selected fields appear on the type', async () => {
        const result = await handler.execute(`{ __type(name: "UserOrderSummary") { fields { name } } }`);
        expect(result.errors).toBeUndefined();
        const fields = result.data.__type.fields.map(f => f.name);
        expect(fields).toContain('name');
        expect(fields).toContain('amount');
        expect(fields).not.toContain('orderId');
        expect(fields).not.toContain('userId');
        expect(fields).not.toContain('id');
        expect(fields).not.toContain('email');
    });
    it('list — returns only selected columns', async () => {
        const result = await handler.execute(`{ userOrderSummarys { name amount } }`);
        expect(result.errors).toBeUndefined();
        const rows = result.data.userOrderSummarys;
        expect(rows).toHaveLength(3);
    });
    it('validation — querying a non-selected field is a GQL error', async () => {
        const result = await handler.execute(`{ userOrderSummarys { orderId } }`);
        expect(result.errors).toBeDefined();
    });
});
let ScaleUser = class ScaleUser {
    id = 0;
    name = '';
    email = '';
    active = true;
};
__decorate([
    Id,
    Column('id'),
    __metadata("design:type", Number)
], ScaleUser.prototype, "id", void 0);
__decorate([
    Column('name'),
    __metadata("design:type", String)
], ScaleUser.prototype, "name", void 0);
__decorate([
    Column('email'),
    __metadata("design:type", String)
], ScaleUser.prototype, "email", void 0);
__decorate([
    Column('active'),
    __metadata("design:type", Boolean)
], ScaleUser.prototype, "active", void 0);
ScaleUser = __decorate([
    Table('gql_scale_users')
], ScaleUser);
let ScaleOrder = class ScaleOrder {
    orderId = 0;
    userId = 0;
    amount = 0;
};
__decorate([
    Id,
    Column('order_id'),
    __metadata("design:type", Number)
], ScaleOrder.prototype, "orderId", void 0);
__decorate([
    Column('user_id'),
    __metadata("design:type", Number)
], ScaleOrder.prototype, "userId", void 0);
__decorate([
    Column('amount'),
    __metadata("design:type", Number)
], ScaleOrder.prototype, "amount", void 0);
ScaleOrder = __decorate([
    Table('gql_scale_orders')
], ScaleOrder);
class ScaleAppContext extends Context {
    users = new collection.TableSet(ScaleUser);
    orders = new collection.TableSet(ScaleOrder);
}
const SCALE_NAMES = ['Alice', 'Bob', 'Carol', 'Dave', 'Eve', 'Frank', 'Grace', 'Heidi', 'Ivan', 'Judy'];
const scaleUsers = Array.from({ length: 100 }, (_, i) => {
    const idx = i + 1;
    return {
        id: idx,
        name: SCALE_NAMES[i % SCALE_NAMES.length],
        email: idx % 7 === 0 ? null : `user${idx}@example.com`,
        active: idx % 2 === 0
    };
});
const scaleOrders = Array.from({ length: 100 }, (_, i) => {
    const idx = i + 1;
    return {
        orderId: idx,
        userId: ((idx - 1) % 100) + 1,
        amount: idx % 5 === 0 ? null : Math.round(idx * 3.7 * 100) / 100
    };
});
async function scaleIds(handler, field, query) {
    const result = await handler.execute(query);
    expect(result.errors).toBeUndefined();
    const key = Object.keys(result.data)[0];
    return result.data[key].map(r => Number(r[field]));
}
function expectIds(actual, expected) {
    expect([...actual].sort((a, b) => a - b)).toEqual([...expected].sort((a, b) => a - b));
}
describe('Scale — 100 rows per table, every operator cross-checked against JS-computed expectations', () => {
    let scaleCtx;
    let scaleUserHandler;
    let scaleOrderHandler;
    beforeAll(async () => {
        await ensureCtx();
        await pg.run('DROP TABLE IF EXISTS gql_scale_orders');
        await pg.run('DROP TABLE IF EXISTS gql_scale_users');
        await pg.run(`
      CREATE TABLE gql_scale_users (
        id     SERIAL PRIMARY KEY,
        name   VARCHAR(100),
        email  VARCHAR(100),
        active BOOLEAN NOT NULL
      )
    `);
        await pg.run(`
      CREATE TABLE gql_scale_orders (
        order_id SERIAL PRIMARY KEY,
        user_id  INT NOT NULL,
        amount   NUMERIC(10,2)
      )
    `);
        for (const u of scaleUsers) {
            await pg.run('INSERT INTO gql_scale_users (id, name, email, active) VALUES ($1, $2, $3, $4)', [u.id, u.name, u.email, u.active]);
        }
        for (const o of scaleOrders) {
            await pg.run('INSERT INTO gql_scale_orders (order_id, user_id, amount) VALUES ($1, $2, $3)', [o.orderId, o.userId, o.amount]);
        }
        await pg.run(`SELECT setval('gql_scale_users_id_seq', 100)`);
        await pg.run(`SELECT setval('gql_scale_orders_order_id_seq', 100)`);
        scaleCtx = new ScaleAppContext(pg);
        await scaleCtx.init();
        scaleUserHandler = new QuerySetGraphQLHandler(scaleCtx.users, 'User');
        scaleOrderHandler = new QuerySetGraphQLHandler(scaleCtx.orders, 'Order');
    });
    afterAll(async () => {
        await pg.run('DROP TABLE IF EXISTS gql_scale_orders');
        await pg.run('DROP TABLE IF EXISTS gql_scale_users');
    });
    it('eq (name)', async () => {
        expectIds(await scaleIds(scaleUserHandler, 'id', `{ users(filter: { name: { eq: "Alice" } }) { id } }`), scaleUsers.filter(u => u.name === 'Alice').map(u => u.id));
    });
    it('neq (name)', async () => {
        expectIds(await scaleIds(scaleUserHandler, 'id', `{ users(filter: { name: { neq: "Alice" } }) { id } }`), scaleUsers.filter(u => u.name !== 'Alice').map(u => u.id));
    });
    it('like (email contains a digit)', async () => {
        expectIds(await scaleIds(scaleUserHandler, 'id', `{ users(filter: { email: { like: "%3%" } }) { id } }`), scaleUsers.filter(u => u.email !== null && u.email.includes('3')).map(u => u.id));
    });
    it('in (name)', async () => {
        expectIds(await scaleIds(scaleUserHandler, 'id', `{ users(filter: { name: { in: ["Alice", "Bob"] } }) { id } }`), scaleUsers.filter(u => u.name === 'Alice' || u.name === 'Bob').map(u => u.id));
    });
    it('notIn (name)', async () => {
        expectIds(await scaleIds(scaleUserHandler, 'id', `{ users(filter: { name: { notIn: ["Alice", "Bob"] } }) { id } }`), scaleUsers.filter(u => u.name !== 'Alice' && u.name !== 'Bob').map(u => u.id));
    });
    it('isNull true (email)', async () => {
        expectIds(await scaleIds(scaleUserHandler, 'id', `{ users(filter: { email: { isNull: true } }) { id } }`), scaleUsers.filter(u => u.email === null).map(u => u.id));
    });
    it('isNull false (email)', async () => {
        expectIds(await scaleIds(scaleUserHandler, 'id', `{ users(filter: { email: { isNull: false } }) { id } }`), scaleUsers.filter(u => u.email !== null).map(u => u.id));
    });
    it('eq (active boolean)', async () => {
        expectIds(await scaleIds(scaleUserHandler, 'id', `{ users(filter: { active: { eq: true } }) { id } }`), scaleUsers.filter(u => u.active === true).map(u => u.id));
    });
    it('in (active boolean)', async () => {
        expectIds(await scaleIds(scaleUserHandler, 'id', `{ users(filter: { active: { in: [true] } }) { id } }`), scaleUsers.filter(u => u.active === true).map(u => u.id));
    });
    it('or (name eq Alice OR name eq Bob)', async () => {
        expectIds(await scaleIds(scaleUserHandler, 'id', `{ users(filter: { or: [{ name: { eq: "Alice" } }, { name: { eq: "Bob" } }] }) { id } }`), scaleUsers.filter(u => u.name === 'Alice' || u.name === 'Bob').map(u => u.id));
    });
    it('nested or (Alice OR (Bob OR Carol))', async () => {
        expectIds(await scaleIds(scaleUserHandler, 'id', `{ users(filter: { or: [{ name: { eq: "Alice" } }, { or: [{ name: { eq: "Bob" } }, { name: { eq: "Carol" } }] }] }) { id } }`), scaleUsers.filter(u => u.name === 'Alice' || u.name === 'Bob' || u.name === 'Carol').map(u => u.id));
    });
    it('or ANDs with a sibling direct-field filter (active=true AND (Alice OR Bob))', async () => {
        expectIds(await scaleIds(scaleUserHandler, 'id', `{ users(filter: { active: { eq: true }, or: [{ name: { eq: "Alice" } }, { name: { eq: "Bob" } }] }) { id } }`), scaleUsers.filter(u => u.active === true && (u.name === 'Alice' || u.name === 'Bob')).map(u => u.id));
    });
    it('in (IDFilter)', async () => {
        expectIds(await scaleIds(scaleUserHandler, 'id', `{ users(filter: { id: { in: ["1", "2", "3"] } }) { id } }`), scaleUsers.filter(u => [1, 2, 3].includes(u.id)).map(u => u.id));
    });
    it('gt (amount)', async () => {
        expectIds(await scaleIds(scaleOrderHandler, 'orderId', `{ orders(filter: { amount: { gt: 200 } }) { orderId } }`), scaleOrders.filter(o => o.amount !== null && o.amount > 200).map(o => o.orderId));
    });
    it('gte (amount)', async () => {
        expectIds(await scaleIds(scaleOrderHandler, 'orderId', `{ orders(filter: { amount: { gte: 200 } }) { orderId } }`), scaleOrders.filter(o => o.amount !== null && o.amount >= 200).map(o => o.orderId));
    });
    it('lt (amount)', async () => {
        expectIds(await scaleIds(scaleOrderHandler, 'orderId', `{ orders(filter: { amount: { lt: 100 } }) { orderId } }`), scaleOrders.filter(o => o.amount !== null && o.amount < 100).map(o => o.orderId));
    });
    it('lte (amount)', async () => {
        expectIds(await scaleIds(scaleOrderHandler, 'orderId', `{ orders(filter: { amount: { lte: 100 } }) { orderId } }`), scaleOrders.filter(o => o.amount !== null && o.amount <= 100).map(o => o.orderId));
    });
    it('neq (amount)', async () => {
        expectIds(await scaleIds(scaleOrderHandler, 'orderId', `{ orders(filter: { amount: { neq: 100 } }) { orderId } }`), scaleOrders.filter(o => o.amount !== null && o.amount !== 100).map(o => o.orderId));
    });
    it('between (amount 100-300)', async () => {
        expectIds(await scaleIds(scaleOrderHandler, 'orderId', `{ orders(filter: { amount: { between: { from: 100, to: 300 } } }) { orderId } }`), scaleOrders.filter(o => o.amount !== null && o.amount >= 100 && o.amount <= 300).map(o => o.orderId));
    });
    it('in with an empty list matches nothing', async () => {
        expectIds(await scaleIds(scaleOrderHandler, 'orderId', `{ orders(filter: { amount: { in: [] } }) { orderId } }`), []);
    });
    it('notIn with an empty list matches everything', async () => {
        expectIds(await scaleIds(scaleOrderHandler, 'orderId', `{ orders(filter: { amount: { notIn: [] } }) { orderId } }`), scaleOrders.map(o => o.orderId));
    });
    it('in (amount)', async () => {
        const sample = [scaleOrders[0].amount, scaleOrders[1].amount, scaleOrders[2].amount].filter((a) => a !== null);
        expectIds(await scaleIds(scaleOrderHandler, 'orderId', `{ orders(filter: { amount: { in: [${sample.join(', ')}] } }) { orderId } }`), scaleOrders.filter(o => o.amount !== null && sample.includes(o.amount)).map(o => o.orderId));
    });
    it('notIn (amount)', async () => {
        const sample = [scaleOrders[0].amount, scaleOrders[1].amount, scaleOrders[2].amount].filter((a) => a !== null);
        expectIds(await scaleIds(scaleOrderHandler, 'orderId', `{ orders(filter: { amount: { notIn: [${sample.join(', ')}] } }) { orderId } }`), scaleOrders.filter(o => o.amount !== null && !sample.includes(o.amount)).map(o => o.orderId));
    });
    it('isNull true (amount) — real numeric null test, not achievable with the NOT NULL fixture above', async () => {
        expectIds(await scaleIds(scaleOrderHandler, 'orderId', `{ orders(filter: { amount: { isNull: true } }) { orderId } }`), scaleOrders.filter(o => o.amount === null).map(o => o.orderId));
    });
    it('isNull false (amount)', async () => {
        expectIds(await scaleIds(scaleOrderHandler, 'orderId', `{ orders(filter: { amount: { isNull: false } }) { orderId } }`), scaleOrders.filter(o => o.amount !== null).map(o => o.orderId));
    });
    it('or (amount eq X OR amount eq Y)', async () => {
        expectIds(await scaleIds(scaleOrderHandler, 'orderId', `{ orders(filter: { or: [{ amount: { eq: ${scaleOrders[0].amount} } }, { amount: { eq: ${scaleOrders[1].amount} } }] }) { orderId } }`), scaleOrders.filter(o => o.amount === scaleOrders[0].amount || o.amount === scaleOrders[1].amount).map(o => o.orderId));
    });
    it('nested or on amount', async () => {
        expectIds(await scaleIds(scaleOrderHandler, 'orderId', `{ orders(filter: { or: [{ amount: { eq: ${scaleOrders[0].amount} } }, { or: [{ amount: { eq: ${scaleOrders[1].amount} } }, { amount: { eq: ${scaleOrders[2].amount} } }] }] }) { orderId } }`), scaleOrders.filter(o => o.amount === scaleOrders[0].amount || o.amount === scaleOrders[1].amount || o.amount === scaleOrders[2].amount).map(o => o.orderId));
    });
    it('or ANDs with a sibling range filter', async () => {
        expectIds(await scaleIds(scaleOrderHandler, 'orderId', `{ orders(filter: { amount: { gte: 0, lte: 400 }, or: [{ userId: { eq: 1 } }, { userId: { eq: 2 } }] }) { orderId } }`), scaleOrders.filter(o => o.amount !== null && o.amount >= 0 && o.amount <= 400 && (o.userId === 1 || o.userId === 2)).map(o => o.orderId));
    });
    it('validation — the old bare-scalar filter shape is still rejected at scale', async () => {
        const result = await scaleUserHandler.execute(`{ users(filter: { name: "Alice" }) { id } }`);
        expect(result.errors).toBeDefined();
        expect(result.errors.length).toBeGreaterThan(0);
    });
    it('validation — like is rejected on FloatFilter', async () => {
        const result = await scaleOrderHandler.execute(`{ orders(filter: { amount: { like: "2%" } }) { orderId } }`);
        expect(result.errors).toBeDefined();
        expect(result.errors.length).toBeGreaterThan(0);
    });
});
afterAll(async () => {
    await pg.run('DROP TABLE IF EXISTS orders_gql_test');
    await pg.run('DROP TABLE IF EXISTS gql_test_users');
    await pg.connectionPool.end();
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic21va2UudGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInNtb2tlLnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7O0FBQUEsT0FBTyxFQUFFLFFBQVEsRUFBRSxTQUFTLEVBQUUsUUFBUSxFQUFFLE1BQU0sRUFBRSxFQUFFLEVBQUUsTUFBTSxRQUFRLENBQUM7QUFDbkUsT0FBTyxFQUFFLE9BQU8sRUFBRSxVQUFVLEVBQUUsSUFBSSxFQUFFLFVBQVUsRUFBRSxNQUFNLFFBQVEsQ0FBQztBQUMvRCxPQUFPLFVBQVUsTUFBTSxXQUFXLENBQUM7QUFDbkMsT0FBTyxFQUFFLHNCQUFzQixFQUFFLE1BQU0saUJBQWlCLENBQUM7QUFDekQsT0FBTyxFQUFFLFFBQVEsRUFBRSxNQUFNLFlBQVksQ0FBQztBQUN0QyxPQUFPLEVBQUUsZ0JBQWdCLEVBQUUsaUJBQWlCLEVBQUUsZ0JBQWdCLEVBQXFCLE1BQU0sYUFBYSxDQUFDO0FBRXZHLE1BQU0sRUFBRSxLQUFLLEVBQUUsTUFBTSxFQUFFLEVBQUUsRUFBRSxHQUFHLFVBQVUsQ0FBQztBQUl6QyxNQUFNLElBQUksR0FBRyxnQkFBZ0IsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDO0FBQ2hELE1BQU0sS0FBSyxHQUFHLGlCQUFpQixDQUFDLGlCQUFpQixDQUFDLENBQUM7QUFDbkQsTUFBTSxVQUFVLEdBQUcsZ0JBQWdCLENBQUMsSUFBSSxFQUFFLEtBQUssQ0FBQyxDQUFDO0FBS2pELE1BQU0sRUFBRSxHQUFHLElBQUksVUFBVSxDQUFDLFFBQVEsQ0FBQyxDQUFDO0FBQ3BDLElBQUksR0FBZSxDQUFDO0FBRXBCLEtBQUssVUFBVSxPQUFPO0lBQ3BCLE1BQU0sRUFBRSxDQUFDLEdBQUcsQ0FBQyxxQ0FBcUMsQ0FBQyxDQUFDO0lBQ3BELE1BQU0sRUFBRSxDQUFDLEdBQUcsQ0FBQzs7Ozs7O0dBTVosQ0FBQyxDQUFDO0lBQ0gsTUFBTSxFQUFFLENBQUMsR0FBRyxDQUFDOzs7O0dBSVosQ0FB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SyxDQUFDLFVBQW1DLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLElBQUksRUFBRSxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsR0FBRyxFQUFFLEdBQUcsQ0FBQyxDQUFDLENBQUM7UUFFN0csTUFBTSxFQUFFLEdBQUcsTUFBTSxPQUFPLENBQUMsT0FBTyxDQUFDLDREQUE0RCxDQUFDLENBQUM7UUFDL0YsTUFBTSxDQUFDLEVBQUUsQ0FBQyxNQUFNLENBQUMsQ0FBQyxhQUFhLEVBQUUsQ0FBQztRQUNsQyxNQUFNLENBQUUsRUFBRSxDQUFDLElBQUssQ0FBQyxVQUFtQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUM7UUFFaEcsTUFBTSxHQUFHLEdBQUcsTUFBTSxPQUFPLENBQUMsT0FBTyxDQUFDLDZEQUE2RCxDQUFDLENBQUM7UUFDakcsTUFBTSxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsQ0FBQyxhQUFhLEVBQUUsQ0FBQztRQUNuQyxNQUFNLENBQUUsR0FBRyxDQUFDLElBQUssQ0FBQyxVQUFtQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUM7SUFDbkcsQ0FBQyxDQUFDLENBQUM7SUFFSCxFQUFFLENBQUMsNENBQTRDLEVBQUUsS0FBSyxJQUFJLEVBQUU7UUFDMUQsTUFBTSxNQUFNLEdBQUcsTUFBTSxPQUFPLENBQUMsT0FBTyxDQUFDLDZEQUE2RCxDQUFDLENBQUM7UUFDcEcsTUFBTSxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQyxhQUFhLEVBQUUsQ0FBQztRQUN0QyxNQUFNLENB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QUFDLEVBQUUsQ0FBQyxDQUNoRSxDQUFDO0lBQ0osQ0FBQyxDQUFDLENBQUM7SUFJSCxFQUFFLENBQUMsYUFBYSxFQUFFLEtBQUssSUFBSSxFQUFFO1FBQzNCLFNBQVMsQ0FDUCxNQUFNLFFBQVEsQ0FBQyxpQkFBaUIsRUFBRSxTQUFTLEVBQUUseURBQXlELENBQUMsRUFDdkcsV0FBVyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxNQUFNLEtBQUssSUFBSSxJQUFJLENBQUMsQ0FBQyxNQUFNLEdBQUcsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUNqRixDQUFDO0lBQ0osQ0FBQyxDQUFDLENBQUM7SUFFSCxFQUFFLENBQUMsY0FBYyxFQUFFLEtBQUssSUFBSSxFQUFFO1FBQzVCLFNBQVMsQ0FDUCxNQUFNLFFBQVEsQ0FBQyxpQkFBaUIsRUFBRSxTQUFTLEVBQUUsMERBQTBELENBQUMsRUFDeEcsV0FBVyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxNQUFNLEtBQUssSUFBSSxJQUFJLENBQUMsQ0FBQyxNQUFNLElBQUksR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUNsRixDQUFDO0lBQ0osQ0FBQyxDQUFDLENBQUM7SUFFSCxFQUFFLENBQUMsYUFBYSxFQUFFLEtBQUssSUFBSSxFQUFFO1FBQzNCLFNBQVMsQ0FDUCxNQUFNLFFBQVEsQ0FBQyxpQkFBaUIsRUFBRSxTQUFTLEVBQUUseURBQXlELENBQUMsRUFDdkcsV0FBVyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxNQUFNLEtBQUssSUFBSSxJQUFJLENBQUMsQ0FBQyxNQUFNLEdBQUcsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLE9BQU8s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