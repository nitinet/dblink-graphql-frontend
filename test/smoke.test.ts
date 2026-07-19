import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Context, collection, core, decorators } from 'dblink';
import PostgreSql from 'dblink-pg';
import { QuerySetGraphQLHandler } from '../src/index.js';

// ── Entities ──────────────────────────────────────────────────────────────

const { Table, Column, Id } = decorators;

@Table('gql_test_users')
class User {
  @Id @Column('id') id = 0;
  @Column('name') name = '';
  @Column('email') email = '';
}

@Table('orders_gql_test')
class Order {
  @Id @Column('order_id') orderId = 0;
  @Column('user_id') userId = 0;
  @Column('amount') amount = 0;
}

class AppContext extends Context {
  users = new collection.TableSet(User);
  orders = new collection.TableSet(Order);
}

// ── Database connection ───────────────────────────────────────────────────

const pgConfig = {
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? 5432),
  database: process.env.PGDATABASE ?? 'postgres',
  user: process.env.PGUSER ?? 'postgres',
  password: process.env.PGPASSWORD ?? 'postgres',
  max: 2,
  idleTimeoutMillis: 1000
};

// ── Fixtures ─────────────────────────────────────────────────────────────

const pg = new PostgreSql(pgConfig);
let ctx: AppContext;

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
  // Alice (user id 1) has two orders; Bob (user id 2) has one order.
  // The user ids are inserted by setupDb() with SERIAL so they are 1 and 2.
  await pg.run(`
    INSERT INTO orders_gql_test (user_id, amount) VALUES
      (1, 100.00),
      (1, 200.00),
      (2, 300.00)
  `);
}

// ══════════════════════════════════════════════════════════════════════════
// Full-table handler
// ══════════════════════════════════════════════════════════════════════════

describe('QuerySetGraphQLHandler — full TableSet (dblink-pg)', () => {
  let handler: QuerySetGraphQLHandler<User>;

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
    expect((result.data!.__schema as { queryType: { name: string } }).queryType.name).toBe('Query');
  });

  it('introspection — User, UserFilter, UserList, OrderDirection types present', async () => {
    const result = await handler.execute(`{
      __schema { types { name kind } }
    }`);
    expect(result.errors).toBeUndefined();
    const names = (result.data!.__schema as { types: { name: string }[] }).types.map(t => t.name);
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
    const fields = (result.data!.__type as { fields: { name: string }[] }).fields.map(f => f.name);
    expect(fields).toContain('id');
    expect(fields).toContain('name');
    expect(fields).toContain('email');
  });

  it('introspection — Query has users, usersCount, usersList fields', async () => {
    const result = await handler.execute(`{
      __type(name: "Query") { fields { name } }
    }`);
    expect(result.errors).toBeUndefined();
    const fields = (result.data!.__type as { fields: { name: string }[] }).fields.map(f => f.name);
    expect(fields).toContain('users');
    expect(fields).toContain('usersCount');
    expect(fields).toContain('usersList');
  });

  // ── Query execution ────────────────────────────────────────────────────

  it('list — returns all rows', async () => {
    const result = await handler.execute(`{ users { id name email } }`);
    expect(result.errors).toBeUndefined();
    const rows = result.data!.users as { name: string }[];
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
    const rows = result.data!.users as { name: string; email: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Alice');
    expect(rows[0].email).toBe('alice@example.com');
  });

  it('list — orderBy DESC', async () => {
    const result = await handler.execute(`{
      users(orderBy: { field: "name", direction: DESC }) { name }
    }`);
    expect(result.errors).toBeUndefined();
    const rows = result.data!.users as { name: string }[];
    expect(rows[0].name).toBe('Bob');
    expect(rows[1].name).toBe('Alice');
  });

  it('list — limit restricts row count', async () => {
    const result = await handler.execute(`{ users(limit: 1) { name } }`);
    expect(result.errors).toBeUndefined();
    expect((result.data!.users as unknown[]).length).toBe(1);
  });

  it('count — returns total row count', async () => {
    const result = await handler.execute(`{ usersCount }`);
    expect(result.errors).toBeUndefined();
    expect(result.data!.usersCount).toBe(2);
  });

  it('count — respects filter', async () => {
    const result = await handler.execute(`{
      usersCount(filter: { name: "Alice" })
    }`);
    expect(result.errors).toBeUndefined();
    expect(result.data!.usersCount).toBe(1);
  });

  it('list result — returns count + values together', async () => {
    const result = await handler.execute(`{
      usersList { count values { name } }
    }`);
    expect(result.errors).toBeUndefined();
    const list = result.data!.usersList as { count: number; values: { name: string }[] };
    expect(list.count).toBe(2);
    expect(list.values).toHaveLength(2);
  });

  it('validation — unknown field returns GraphQL error', async () => {
    const result = await handler.execute(`{ users { nonExistentField } }`);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  it('multiple requests do not accumulate filter state', async () => {
    // First request with a filter
    await handler.execute(`{ users(filter: { name: "Alice" }) { name } }`);
    // Second request without filter — must still see all rows
    const result = await handler.execute(`{ users { name } }`);
    expect(result.errors).toBeUndefined();
    expect((result.data!.users as unknown[]).length).toBe(2);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// select()-narrowed queryset
// ══════════════════════════════════════════════════════════════════════════

describe('QuerySetGraphQLHandler — select()-narrowed QuerySet (dblink-pg)', () => {
  let handler: QuerySetGraphQLHandler<Pick<User, 'id' | 'name'>>;

  beforeAll(async () => {
    // ctx and pg are already set up by the first describe block when tests run
    // together; guard for standalone execution.
    if (!ctx) {
      await pg.init();
      await setupDb();
      ctx = new AppContext(pg);
      await ctx.init();
    }
    // Expose only id + name — email must not appear in schema or results
    handler = new QuerySetGraphQLHandler(ctx.users.select(['id', 'name']), 'UserSummary');
  });

  it('introspection — only selected fields appear on the type', async () => {
    const result = await handler.execute(`{
      __type(name: "UserSummary") { fields { name } }
    }`);
    expect(result.errors).toBeUndefined();
    const fields = (result.data!.__type as { fields: { name: string }[] }).fields.map(f => f.name);
    expect(fields).toContain('id');
    expect(fields).toContain('name');
    expect(fields).not.toContain('email');
  });

  it('list — returns only selected columns', async () => {
    const result = await handler.execute(`{ userSummarys { id name } }`);
    expect(result.errors).toBeUndefined();
    const rows = result.data!.userSummarys as { id: string; name: string }[];
    expect(rows).toHaveLength(2);
  });

  it('validation — querying a non-selected field is a GQL error', async () => {
    const result = await handler.execute(`{ userSummarys { email } }`);
    expect(result.errors).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Pre-filtered queryset (base where condition baked in)
// ══════════════════════════════════════════════════════════════════════════

describe('QuerySetGraphQLHandler — pre-filtered QuerySet (dblink-pg)', () => {
  let handler: QuerySetGraphQLHandler<User>;

  beforeAll(async () => {
    if (!ctx) {
      await pg.init();
      await setupDb();
      ctx = new AppContext(pg);
      await ctx.init();
    }
    // Base queryset already limits to Alice
    const aliceOnly = ctx.users.where(eb => eb.eq('name', 'Alice'));
    handler = new QuerySetGraphQLHandler(aliceOnly, 'AliceUser');
  });

  it('list — base filter restricts results regardless of GQL args', async () => {
    const result = await handler.execute(`{ aliceUsers { name } }`);
    expect(result.errors).toBeUndefined();
    const rows = result.data!.aliceUsers as { name: string }[];
    expect(rows.every(r => r.name === 'Alice')).toBe(true);
  });

  it('count — reflects base filter', async () => {
    const result = await handler.execute(`{ aliceUsersCount }`);
    expect(result.errors).toBeUndefined();
    expect(result.data!.aliceUsersCount).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// JoinQuerySet (users INNER JOIN orders)
// ══════════════════════════════════════════════════════════════════════════

describe('QuerySetGraphQLHandler — JoinQuerySet (dblink-pg)', () => {
  let handler: QuerySetGraphQLHandler<User & Order>;

  beforeAll(async () => {
    if (!ctx) {
      await pg.init();
      await setupDb();
      ctx = new AppContext(pg);
      await ctx.init();
    }
    await setupOrdersDb();

    // Inner join: users JOIN orders ON users.id = orders.user_id
    const joinQS = ctx.users.join(ctx.orders, (u, o) => u.eq('id', o.col('userId')));
    handler = new QuerySetGraphQLHandler(joinQS, 'UserOrder');
  });

  it('introspection — schema query type is Query', async () => {
    const result = await handler.execute(`{ __schema { queryType { name } } }`);
    expect(result.errors).toBeUndefined();
    expect((result.data!.__schema as { queryType: { name: string } }).queryType.name).toBe('Query');
  });

  it('introspection — UserOrder, UserOrderFilter, UserOrderList types present', async () => {
    const result = await handler.execute(`{ __schema { types { name } } }`);
    expect(result.errors).toBeUndefined();
    const names = (result.data!.__schema as { types: { name: string }[] }).types.map(t => t.name);
    expect(names).toContain('UserOrder');
    expect(names).toContain('UserOrderFilter');
    expect(names).toContain('UserOrderList');
  });

  it('introspection — UserOrder type exposes combined fields', async () => {
    const result = await handler.execute(`{ __type(name: "UserOrder") { fields { name } } }`);
    expect(result.errors).toBeUndefined();
    const fields = (result.data!.__type as { fields: { name: string }[] }).fields.map(f => f.name);
    // Fields from both User (id, name, email) and Order (orderId, userId, amount) — all unique
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
    const fields = (result.data!.__type as { fields: { name: string }[] }).fields.map(f => f.name);
    expect(fields).toContain('userOrders');
    expect(fields).toContain('userOrdersCount');
    expect(fields).toContain('userOrdersList');
  });

  it('list — returns all joined rows (3 total: 2 for Alice, 1 for Bob)', async () => {
    const result = await handler.execute(`{ userOrders { name amount } }`);
    expect(result.errors).toBeUndefined();
    const rows = result.data!.userOrders as { name: string; amount: number }[];
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
    const rows = result.data!.userOrders as { name: string; amount: number }[];
    expect(rows).toHaveLength(2);
    expect(rows.every(r => r.name === 'Alice')).toBe(true);
  });

  it('list — orderBy amount DESC', async () => {
    const result = await handler.execute(`{
      userOrders(orderBy: { field: "amount", direction: DESC }) { name amount }
    }`);
    expect(result.errors).toBeUndefined();
    const rows = result.data!.userOrders as { amount: string | number }[];
    expect(Number(rows[0].amount)).toBe(300);
    expect(Number(rows[rows.length - 1].amount)).toBe(100);
  });

  it('list — limit restricts row count', async () => {
    const result = await handler.execute(`{ userOrders(limit: 2) { name } }`);
    expect(result.errors).toBeUndefined();
    expect((result.data!.userOrders as unknown[]).length).toBe(2);
  });

  it('count — returns total joined row count', async () => {
    const result = await handler.execute(`{ userOrdersCount }`);
    expect(result.errors).toBeUndefined();
    expect(result.data!.userOrdersCount).toBe(3);
  });

  it('count — respects filter on joined field', async () => {
    const result = await handler.execute(`{
      userOrdersCount(filter: { name: "Alice" })
    }`);
    expect(result.errors).toBeUndefined();
    expect(result.data!.userOrdersCount).toBe(2);
  });

  it('list result — returns count + values together', async () => {
    const result = await handler.execute(`{
      userOrdersList { count values { name amount } }
    }`);
    expect(result.errors).toBeUndefined();
    const list = result.data!.userOrdersList as { count: number; values: unknown[] };
    expect(list.count).toBe(3);
    expect(list.values).toHaveLength(3);
  });

  it('multiple requests do not accumulate filter state', async () => {
    await handler.execute(`{ userOrders(filter: { name: "Alice" }) { name } }`);
    const result = await handler.execute(`{ userOrders { name } }`);
    expect(result.errors).toBeUndefined();
    expect((result.data!.userOrders as unknown[]).length).toBe(3);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// LeftJoin (users LEFT JOIN orders) — some users have no matching orders
// ══════════════════════════════════════════════════════════════════════════

describe('QuerySetGraphQLHandler — LeftJoin (dblink-pg)', () => {
  let handler: QuerySetGraphQLHandler<User & Order>;

  beforeAll(async () => {
    if (!ctx) {
      await pg.init();
      await setupDb();
      ctx = new AppContext(pg);
      await ctx.init();
    }
    await setupOrdersDb();
    // Carol has no orders — only a LEFT JOIN should surface her (with null order fields)
    await pg.run(`INSERT INTO gql_test_users (name, email) VALUES ('Carol', 'carol@example.com')`);

    const leftJoinQS = ctx.users.join(ctx.orders, (u, o) => u.eq('id', o.col('userId')), core.sql.types.Join.LeftJoin);
    handler = new QuerySetGraphQLHandler(leftJoinQS, 'UserOrderLeft');
  });

  it('list — includes the user with no matching orders, with null order fields', async () => {
    const result = await handler.execute(`{ userOrderLefts { name orderId amount } }`);
    expect(result.errors).toBeUndefined();
    const rows = result.data!.userOrderLefts as { name: string; orderId: string | null; amount: number | null }[];
    // Alice (2 orders) + Bob (1 order) + Carol (0 orders, null-filled) = 4 rows
    expect(rows).toHaveLength(4);
    const carolRow = rows.find(r => r.name === 'Carol');
    expect(carolRow).toBeDefined();
    expect(carolRow!.orderId).toBeNull();
    expect(carolRow!.amount).toBeNull();
  });

  it('count — includes the null-filled row for the unmatched user', async () => {
    const result = await handler.execute(`{ userOrderLeftsCount }`);
    expect(result.errors).toBeUndefined();
    expect(result.data!.userOrderLeftsCount).toBe(4);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// select() narrowing on a JoinQuerySet
// ══════════════════════════════════════════════════════════════════════════

describe('QuerySetGraphQLHandler — select()-narrowed JoinQuerySet (dblink-pg)', () => {
  let handler: QuerySetGraphQLHandler<Pick<User & Order, 'name' | 'amount'>>;

  beforeAll(async () => {
    if (!ctx) {
      await pg.init();
      await setupDb();
      ctx = new AppContext(pg);
      await ctx.init();
    }
    await setupOrdersDb();

    // Inner join (default), narrowed to only name + amount
    const narrowedJoin = ctx.users.join(ctx.orders, (u, o) => u.eq('id', o.col('userId'))).select(['name', 'amount']);
    handler = new QuerySetGraphQLHandler(narrowedJoin, 'UserOrderSummary');
  });

  it('introspection — only selected fields appear on the type', async () => {
    const result = await handler.execute(`{ __type(name: "UserOrderSummary") { fields { name } } }`);
    expect(result.errors).toBeUndefined();
    const fields = (result.data!.__type as { fields: { name: string }[] }).fields.map(f => f.name);
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
    // Carol has no orders, so the default InnerJoin excludes her: Alice (2) + Bob (1) = 3
    const rows = result.data!.userOrderSummarys as { name: string; amount: number }[];
    expect(rows).toHaveLength(3);
  });

  it('validation — querying a non-selected field is a GQL error', async () => {
    const result = await handler.execute(`{ userOrderSummarys { orderId } }`);
    expect(result.errors).toBeDefined();
  });
});

// Drop test tables and end the pg pool once all suites have finished
afterAll(async () => {
  await pg.run('DROP TABLE IF EXISTS orders_gql_test');
  await pg.run('DROP TABLE IF EXISTS gql_test_users');
  await pg.connectionPool.end();
});
