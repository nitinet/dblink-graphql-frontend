import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'graphql';
import PostgreSql from 'dblink-pg';
import { GraphQLHandler } from '../src/index.js';
import { pgConfig } from './setup.js';
import { createAppContext, createOrderEntity, createUserEntity, EmptyContext } from './models.js';

// ── Entities ──────────────────────────────────────────────────────────────

const User = createUserEntity('gql_full_users');
const Order = createOrderEntity('gql_full_orders');
const AppContext = createAppContext(User, Order);
type AppContext = InstanceType<typeof AppContext>;

// ── Database connection ───────────────────────────────────────────────────

const pg = new PostgreSql(pgConfig);
let ctx: AppContext;

async function setupDb() {
  await pg.run('DROP TABLE IF EXISTS gql_full_orders');
  await pg.run('DROP TABLE IF EXISTS gql_full_users');
  await pg.run(`
    CREATE TABLE gql_full_users (
      id    SERIAL PRIMARY KEY,
      name  VARCHAR(100),
      email VARCHAR(100)
    )
  `);
  await pg.run(`
    CREATE TABLE gql_full_orders (
      order_id SERIAL PRIMARY KEY,
      user_id  INT NOT NULL,
      amount   NUMERIC(10,2) NOT NULL
    )
  `);
  await pg.run(`
    INSERT INTO gql_full_users (name, email) VALUES
      ('Alice', 'alice@example.com'),
      ('Bob',   'bob@example.com')
  `);
  // Alice (user id 1) has two orders; Bob (user id 2) has one.
  await pg.run(`
    INSERT INTO gql_full_orders (user_id, amount) VALUES
      (1, 100.00),
      (1, 200.00),
      (2, 300.00)
  `);
}

// ══════════════════════════════════════════════════════════════════════════
// GraphQLHandler — full Context (every registered TableSet)
// ══════════════════════════════════════════════════════════════════════════

describe('GraphQLHandler — full Context (dblink-pg)', () => {
  let handler: GraphQLHandler;

  beforeAll(async () => {
    await pg.init();
    await setupDb();
    ctx = new AppContext(pg);
    await ctx.init();
    handler = new GraphQLHandler(ctx);
  });

  it('getSchema() returns the underlying GraphQLSchema', () => {
    const schema = handler.getSchema();
    expect(schema.getQueryType()?.name).toBe('Query');
  });

  it('introspection — a top-level query field is generated per registered TableSet', async () => {
    const result = await handler.execute(`{ __type(name: "Query") { fields { name } } }`);
    expect(result.errors).toBeUndefined();
    const fields = (result.data!.__type as { fields: { name: string }[] }).fields.map(f => f.name);
    expect(fields).toEqual(expect.arrayContaining(['users', 'usersCount', 'usersList', 'orders', 'ordersCount', 'ordersList']));
  });

  it('introspection — User and Order object types are both present, independently of each other', async () => {
    const result = await handler.execute(`{ __schema { types { name } } }`);
    expect(result.errors).toBeUndefined();
    const names = (result.data!.__schema as { types: { name: string }[] }).types.map(t => t.name);
    expect(names).toEqual(expect.arrayContaining(['User', 'UserFilter', 'Order', 'OrderFilter']));
  });

  it('list — queries against two different TableSets in a single request', async () => {
    const result = await handler.execute(`{
      users { name }
      orders { amount }
    }`);
    expect(result.errors).toBeUndefined();
    expect((result.data!.users as unknown[]).length).toBe(2);
    expect((result.data!.orders as unknown[]).length).toBe(3);
  });

  it('list — filter arg narrows one TableSet without affecting the other', async () => {
    const result = await handler.execute(`{
      users(filter: { name: { eq: "Alice" } }) { name }
      orders { amount }
    }`);
    expect(result.errors).toBeUndefined();
    expect(result.data!.users).toEqual([{ name: 'Alice' }]);
    expect((result.data!.orders as unknown[]).length).toBe(3);
  });

  it('count — usersCount and ordersCount are independent', async () => {
    const result = await handler.execute(`{ usersCount ordersCount }`);
    expect(result.errors).toBeUndefined();
    expect(result.data!.usersCount).toBe(2);
    expect(result.data!.ordersCount).toBe(3);
  });

  it('list result — usersList returns count + values together', async () => {
    const result = await handler.execute(`{ usersList { count values { name } } }`);
    expect(result.errors).toBeUndefined();
    const list = result.data!.usersList as { count: number; values: { name: string }[] };
    expect(list.count).toBe(2);
    expect(list.values).toHaveLength(2);
  });

  it('list — orderBy and limit apply per field', async () => {
    const result = await handler.execute(`{ orders(orderBy: { field: "amount", direction: DESC }, limit: 1) { amount } }`);
    expect(result.errors).toBeUndefined();
    const rows = result.data!.orders as { amount: number }[];
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].amount)).toBe(300);
  });

  it('validation — querying an unregistered field on Query is a GraphQL error', async () => {
    const result = await handler.execute(`{ doesNotExist { name } }`);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  it('execute() accepts a pre-parsed DocumentNode instead of a string', async () => {
    const document = parse(`{ usersCount }`);
    const result = await handler.execute(document);
    expect(result.errors).toBeUndefined();
    expect(result.data!.usersCount).toBe(2);
  });

  it('execute() forwards variables to the query', async () => {
    const result = await handler.execute(`query UsersByName($name: String!) { users(filter: { name: { eq: $name } }) { name } }`, { name: 'Bob' });
    expect(result.errors).toBeUndefined();
    expect(result.data!.users).toEqual([{ name: 'Bob' }]);
  });

  it('execute() runs the operation selected by operationName among multiple named operations', async () => {
    const document = `
      query GetUsersCount { usersCount }
      query GetOrdersCount { ordersCount }
    `;
    const usersResult = await handler.execute(document, undefined, 'GetUsersCount');
    expect(usersResult.errors).toBeUndefined();
    expect(usersResult.data).toEqual({ usersCount: 2 });

    const ordersResult = await handler.execute(document, undefined, 'GetOrdersCount');
    expect(ordersResult.errors).toBeUndefined();
    expect(ordersResult.data).toEqual({ ordersCount: 3 });
  });

  it('multiple requests do not accumulate filter state across TableSets', async () => {
    await handler.execute(`{ users(filter: { name: { eq: "Alice" } }) { name } }`);
    const result = await handler.execute(`{ users { name } }`);
    expect(result.errors).toBeUndefined();
    expect((result.data!.users as unknown[]).length).toBe(2);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Error paths
// ══════════════════════════════════════════════════════════════════════════

describe('GraphQLHandler — construction errors (dblink-pg)', () => {
  it('throws when the Context has no registered TableSets', async () => {
    if (!ctx) {
      await pg.init();
      await setupDb();
    }
    const emptyCtx = new EmptyContext(pg);
    await emptyCtx.init();
    expect(() => new GraphQLHandler(emptyCtx)).toThrow(/no registered TableSets/);
  });
});

afterAll(async () => {
  await pg.run('DROP TABLE IF EXISTS gql_full_orders');
  await pg.run('DROP TABLE IF EXISTS gql_full_users');
  await pg.connectionPool.end();
});
