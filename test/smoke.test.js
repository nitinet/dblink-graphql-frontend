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
import { Context, collection, core, decorators } from 'dblink';
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
describe('QuerySetGraphQLHandler — LeftJoin (dblink-pg)', () => {
    let handler;
    beforeAll(async () => {
        if (!ctx) {
            await pg.init();
            await setupDb();
            ctx = new AppContext(pg);
            await ctx.init();
        }
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
        if (!ctx) {
            await pg.init();
            await setupDb();
            ctx = new AppContext(pg);
            await ctx.init();
        }
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
afterAll(async () => {
    await pg.run('DROP TABLE IF EXISTS orders_gql_test');
    await pg.run('DROP TABLE IF EXISTS gql_test_users');
    await pg.connectionPool.end();
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic21va2UudGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInNtb2tlLnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7O0FBQUEsT0FBTyxrQkFBa0IsQ0FBQztBQUMxQixPQUFPLEVBQUUsUUFBUSxFQUFFLFNBQVMsRUFBRSxRQUFRLEVBQUUsTUFBTSxFQUFFLEVBQUUsRUFBRSxNQUFNLFFBQVEsQ0FBQztBQUNuRSxPQUFPLEVBQUUsT0FBTyxFQUFFLFVBQVUsRUFBRSxJQUFJLEVBQUUsVUFBVSxFQUFFLE1BQU0sUUFBUSxDQUFDO0FBQy9ELE9BQU8sVUFBVSxNQUFNLFdBQVcsQ0FBQztBQUNuQyxPQUFPLEVBQUUsc0JBQXNCLEVBQUUsTUFBTSxpQkFBaUIsQ0FBQztBQUl6RCxNQUFNLEVBQUUsS0FBSyxFQUFFLE1BQU0sRUFBRSxFQUFFLEVBQUUsR0FBRyxVQUFVLENBQUM7QUFHekMsSUFBTSxJQUFJLEdBQVYsTUFBTSxJQUFJO0lBQ1UsRUFBRSxHQUFHLENBQUMsQ0FBQztJQUNULElBQUksR0FBRyxFQUFFLENBQUM7SUFDVCxLQUFLLEdBQUcsRUFBRSxDQUFDO0NBQzdCLENBQUE7QUFIbUI7SUFBakIsRUFBRTtJQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUM7O2dDQUFRO0FBQ1Q7SUFBZixNQUFNLENBQUMsTUFBTSxDQUFDOztrQ0FBVztBQUNUO0lBQWhCLE1BQU0sQ0FBQyxPQUFPLENBQUM7O21DQUFZO0FBSHhCLElBQUk7SUFEVCxLQUFLLENBQUMsZ0JBQWdCLENBQUM7R0FDbEIsSUFBSSxDQUlUO0FBR0QsSUFBTSxLQUFLLEdBQVgsTUFBTSxLQUFLO0lBQ2UsT0FBTyxHQUFHLENBQUMsQ0FBQztJQUNqQixNQUFNLEdBQUcsQ0FBQyxDQUFDO0lBQ1osTUFBTSxHQUFHLENBQUMsQ0FBQztDQUM5QixDQUFBO0FBSHlCO0lBQXZCLEVBQUU7SUFBRSxNQUFNLENBQUMsVUFBVSxDQUFDOztzQ0FBYTtBQUNqQjtJQUFsQixNQUFN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