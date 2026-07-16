var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Context, collection, decorators } from 'dblink';
import PostgreSql from 'dblink-pg';
import { QuerySetGraphQLHandler } from '../src/index.js';
const { Table, Column, Id } = decorators;
let User = class User {
    id = 0;
    name = '';
    email = '';
};
__decorate([
    Id,
    Column('id'),
    __metadata("design:type", Object)
], User.prototype, "id", void 0);
__decorate([
    Column('name'),
    __metadata("design:type", Object)
], User.prototype, "name", void 0);
__decorate([
    Column('email'),
    __metadata("design:type", Object)
], User.prototype, "email", void 0);
User = __decorate([
    Table('gql_test_users')
], User);
let Order = class Order {
    orderId = 0;
    userId = 0;
    amount = 0;
};
__decorate([
    Id,
    Column('order_id'),
    __metadata("design:type", Object)
], Order.prototype, "orderId", void 0);
__decorate([
    Column('user_id'),
    __metadata("design:type", Object)
], Order.prototype, "userId", void 0);
__decorate([
    Column('amount'),
    __metadata("design:type", Object)
], Order.prototype, "amount", void 0);
Order = __decorate([
    Table('orders_gql_test')
], Order);
class AppContext extends Context {
    users = new collection.TableSet(User);
    orders = new collection.TableSet(Order);
}
const pgConfig = {
    host: process.env.PGHOST ?? 'localhost',
    port: Number(process.env.PGPORT ?? 5432),
    database: process.env.PGDATABASE ?? 'postgres',
    user: process.env.PGUSER ?? 'postgres',
    password: process.env.PGPASSWORD ?? 'postgres',
    max: 2,
    idleTimeoutMillis: 1000
};
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
    it('list — filter arg narrows results', async () => {
        const result = await handler.execute(`{
      users(filter: { name: "Alice" }) { id name email }
    }`);
        expect(result.errors).toBeUndefined();
        const rows = result.data.users;
        expect(rows).toHaveLength(1);
        expect(rows[0].name).toBe('Alice');
        expect(rows[0].email).toBe('alice@example.com');
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
      usersCount(filter: { name: "Alice" })
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
    it('validation — unknown field returns GraphQL error', async () => {
        const result = await handler.execute(`{ users { nonExistentField } }`);
        expect(result.errors).toBeDefined();
        expect(result.errors.length).toBeGreaterThan(0);
    });
    it('multiple requests do not accumulate filter state', async () => {
        await handler.execute(`{ users(filter: { name: "Alice" }) { name } }`);
        const result = await handler.execute(`{ users { name } }`);
        expect(result.errors).toBeUndefined();
        expect(result.data.users.length).toBe(2);
    });
});
describe('QuerySetGraphQLHandler — select()-narrowed QuerySet (dblink-pg)', () => {
    let handler;
    beforeAll(async () => {
        if (!ctx) {
            await pg.init();
            await setupDb();
            ctx = new AppContext(pg);
            await ctx.init();
        }
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
        if (!ctx) {
            await pg.init();
            await setupDb();
            ctx = new AppContext(pg);
            await ctx.init();
        }
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
        if (!ctx) {
            await pg.init();
            await setupDb();
            ctx = new AppContext(pg);
            await ctx.init();
        }
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
      userOrders(filter: { name: "Alice" }) { name amount }
    }`);
        expect(result.errors).toBeUndefined();
        const rows = result.data.userOrders;
        expect(rows).toHaveLength(2);
        expect(rows.every(r => r.name === 'Alice')).toBe(true);
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
      userOrdersCount(filter: { name: "Alice" })
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
    it('multiple requests do not accumulate filter state', async () => {
        await handler.execute(`{ userOrders(filter: { name: "Alice" }) { name } }`);
        const result = await handler.execute(`{ userOrders { name } }`);
        expect(result.errors).toBeUndefined();
        expect(result.data.userOrders.length).toBe(3);
    });
});
afterAll(async () => {
    await pg.run('DROP TABLE IF EXISTS orders_gql_test');
    await pg.run('DROP TABLE IF EXISTS gql_test_users');
    await pg.connectionPool.end();
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic21va2UudGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInNtb2tlLnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7O0FBQUEsT0FBTyxrQkFBa0IsQ0FBQztBQUMxQixPQUFPLEVBQUUsUUFBUSxFQUFFLFNBQVMsRUFBRSxRQUFRLEVBQUUsTUFBTSxFQUFFLEVBQUUsRUFBRSxNQUFNLFFBQVEsQ0FBQztBQUNuRSxPQUFPLEVBQUUsT0FBTyxFQUFFLFVBQVUsRUFBRSxVQUFVLEVBQUUsTUFBTSxRQUFRLENBQUM7QUFDekQsT0FBTyxVQUFVLE1BQU0sV0FBVyxDQUFDO0FBQ25DLE9BQU8sRUFBRSxzQkFBc0IsRUFBRSxNQUFNLGlCQUFpQixDQUFDO0FBSXpELE1BQU0sRUFBRSxLQUFLLEVBQUUsTUFBTSxFQUFFLEVBQUUsRUFBRSxHQUFHLFVBQVUsQ0FBQztBQUd6QyxJQUFNLElBQUksR0FBVixNQUFNLElBQUk7SUFDVSxFQUFFLEdBQUcsQ0FBQyxDQUFDO0lBQ1QsSUFBSSxHQUFHLEVBQUUsQ0FBQztJQUNULEtBQUssR0FBRyxFQUFFLENBQUM7Q0FDN0IsQ0FBQTtBQUhtQjtJQUFqQixFQUFFO0lBQUUsTUFBTSxDQUFDLElBQUksQ0FBQzs7Z0NBQVE7QUFDVDtJQUFmLE1BQU0sQ0FBQyxNQUFNLENBQUM7O2tDQUFXO0FBQ1Q7SUFBaEIsTUFBTSxDQUFDLE9BQU8sQ0FBQzs7bUNBQVk7QUFIeEIsSUFBSTtJQURULEtBQUssQ0FBQyxnQkFBZ0IsQ0FBQztHQUNsQixJQUFJLENBSVQ7QUFHRCxJQUFNLEtBQUssR0FBWCxNQUFNLEtBQUs7SUFDZSxPQUFPLEdBQUcsQ0FBQyxDQUFDO0lBQ2pCLE1BQU0sR0FBRyxDQUFDLENBQUM7SUFDWixNQUFNLEdBQUcsQ0FBQyxDQUFDO0NBQzlCLENBQUE7QUFIeUI7SUFBdkIsRUFBRTtJQUFFLE1BQU0sQ0FBQyxVQUFVLENBQUM7O3NDQUFhO0FBQ2pCO0lBQWxCLE1BQU0sQ0FBQyxTQUFT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