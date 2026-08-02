import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Context, collection, core, decorators } from 'dblink';
import PostgreSql from 'dblink-pg';
import { QuerySetGraphQLHandler } from '../src/index.js';
import { pgConfig } from './setup.js';
import { createAppContext, createOrderEntity, createUserEntity, OrderRow, UserRow } from './models.js';

const { Table, Column, Id } = decorators;

// ── Entities ──────────────────────────────────────────────────────────────

const User = createUserEntity('gql_test_users');
const Order = createOrderEntity('orders_gql_test');
const AppContext = createAppContext(User, Order);
type AppContext = InstanceType<typeof AppContext>;

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

/**
 * The first describe block's beforeAll() already sets up ctx and pg when
 * tests run together; this guard makes every other describe block work when
 * run standalone too (`vitest run -t "..."`), without redoing setup.
 */
async function ensureCtx() {
  if (ctx) return;
  await pg.init();
  await setupDb();
  ctx = new AppContext(pg);
  await ctx.init();
}

// ══════════════════════════════════════════════════════════════════════════
// Full-table handler
// ══════════════════════════════════════════════════════════════════════════

describe('QuerySetGraphQLHandler — full TableSet (dblink-pg)', () => {
  let handler: QuerySetGraphQLHandler<UserRow>;

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

  it('introspection — StringFilter offers eq/neq/like/in/notIn/isNull (no between)', async () => {
    const result = await handler.execute(`{
      __type(name: "StringFilter") { inputFields { name } }
    }`);
    expect(result.errors).toBeUndefined();
    const ops = (result.data!.__type as { inputFields: { name: string }[] }).inputFields.map(f => f.name);
    expect(ops.sort()).toEqual(['eq', 'in', 'isNull', 'like', 'neq', 'notIn']);
  });

  it('introspection — IDFilter offers eq/neq/in/notIn/isNull (no like, no ordering, no between) — same shape as BooleanFilter', async () => {
    const result = await handler.execute(`{
      __type(name: "IDFilter") { inputFields { name } }
    }`);
    expect(result.errors).toBeUndefined();
    const ops = (result.data!.__type as { inputFields: { name: string }[] }).inputFields.map(f => f.name);
    expect(ops.sort()).toEqual(['eq', 'in', 'isNull', 'neq', 'notIn']);
  });

  it('introspection — UserFilter has a self-referential or field', async () => {
    const result = await handler.execute(`{
      __type(name: "UserFilter") { inputFields { name type { kind ofType { kind name } } } }
    }`);
    expect(result.errors).toBeUndefined();
    const fields = (result.data!.__type as { inputFields: { name: string; type: { kind: string; ofType: { kind: string; name: string } | null } }[] }).inputFields;
    const orField = fields.find(f => f.name === 'or');
    expect(orField).toBeDefined();
    expect(orField!.type.kind).toBe('LIST');
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

  it('list — filter arg narrows results (eq)', async () => {
    const result = await handler.execute(`{
      users(filter: { name: { eq: "Alice" } }) { id name email }
    }`);
    expect(result.errors).toBeUndefined();
    const rows = result.data!.users as { name: string; email: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Alice');
    expect(rows[0].email).toBe('alice@example.com');
  });

  it('list — filter neq excludes a match', async () => {
    const result = await handler.execute(`{
      users(filter: { name: { neq: "Alice" } }) { name }
    }`);
    expect(result.errors).toBeUndefined();
    const rows = result.data!.users as { name: string }[];
    expect(rows.map(r => r.name)).toEqual(['Bob']);
  });

  it('list — filter like matches a pattern', async () => {
    const result = await handler.execute(`{
      users(filter: { email: { like: "%example.com" } }) { name }
    }`);
    expect(result.errors).toBeUndefined();
    const rows = result.data!.users as { name: string }[];
    expect(rows).toHaveLength(2);
  });

  it('validation — bare scalar filter shape is rejected', async () => {
    const result = await handler.execute(`{
      users(filter: { name: "Alice" }) { name }
    }`);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  it('list — filter in matches a set of values', async () => {
    const result = await handler.execute(`{
      users(filter: { name: { in: ["Alice", "Nobody"] } }) { name }
    }`);
    expect(result.errors).toBeUndefined();
    const rows = result.data!.users as { name: string }[];
    expect(rows.map(r => r.name)).toEqual(['Alice']);
  });

  it('list — filter notIn excludes a set of values', async () => {
    const result = await handler.execute(`{
      users(filter: { name: { notIn: ["Alice"] } }) { name }
    }`);
    expect(result.errors).toBeUndefined();
    const rows = result.data!.users as { name: string }[];
    expect(rows.map(r => r.name)).toEqual(['Bob']);
  });

  it('list — or combinator matches either branch', async () => {
    const result = await handler.execute(`{
      users(filter: { or: [{ name: { eq: "Alice" } }, { name: { eq: "Bob" } }] }) { name }
    }`);
    expect(result.errors).toBeUndefined();
    const rows = result.data!.users as { name: string }[];
    expect(rows.map(r => r.name).sort()).toEqual(['Alice', 'Bob']);
  });

  it('list — or combinator ANDs with a sibling direct-field filter', async () => {
    const result = await handler.execute(`{
      users(filter: { email: { like: "%example.com" }, or: [{ name: { eq: "Alice" } }, { name: { eq: "Nobody" } }] }) { name }
    }`);
    expect(result.errors).toBeUndefined();
    const rows = result.data!.users as { name: string }[];
    expect(rows.map(r => r.name)).toEqual(['Alice']);
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
      usersCount(filter: { name: { eq: "Alice" } })
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

  it('list result — count ignores limit (reflects the total, not the page)', async () => {
    const result = await handler.execute(`{
      usersList(limit: 1) { count values { name } }
    }`);
    expect(result.errors).toBeUndefined();
    const list = result.data!.usersList as { count: number; values: { name: string }[] };
    expect(list.count).toBe(2);
    expect(list.values).toHaveLength(1);
  });

  it('list result — count ignores offset', async () => {
    const result = await handler.execute(`{
      usersList(offset: 1, limit: 1) { count values { name } }
    }`);
    expect(result.errors).toBeUndefined();
    const list = result.data!.usersList as { count: number; values: { name: string }[] };
    expect(list.count).toBe(2);
    expect(list.values).toHaveLength(1);
  });

  it('list result — count reflects the filtered total, not just the page', async () => {
    const result = await handler.execute(`{
      usersList(filter: { email: { like: "%example.com" } }, limit: 1) { count values { name } }
    }`);
    expect(result.errors).toBeUndefined();
    const list = result.data!.usersList as { count: number; values: { name: string }[] };
    expect(list.count).toBe(2);
    expect(list.values).toHaveLength(1);
  });

  it('validation — unknown field returns GraphQL error', async () => {
    const result = await handler.execute(`{ users { nonExistentField } }`);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  it('multiple requests do not accumulate filter state', async () => {
    // First request with a filter
    await handler.execute(`{ users(filter: { name: { eq: "Alice" } }) { name } }`);
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
  let handler: QuerySetGraphQLHandler<Pick<UserRow, 'id' | 'name'>>;

  beforeAll(async () => {
    await ensureCtx();
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
  let handler: QuerySetGraphQLHandler<UserRow>;

  beforeAll(async () => {
    await ensureCtx();
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
  let handler: QuerySetGraphQLHandler<UserRow & OrderRow>;

  beforeAll(async () => {
    await ensureCtx();
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
      userOrders(filter: { name: { eq: "Alice" } }) { name amount }
    }`);
    expect(result.errors).toBeUndefined();
    const rows = result.data!.userOrders as { name: string; amount: number }[];
    expect(rows).toHaveLength(2);
    expect(rows.every(r => r.name === 'Alice')).toBe(true);
  });

  // Order amounts: Alice has 100 and 200, Bob has 300.
  it('list — filter gt/gte/lt/lte narrow a numeric (Float) field', async () => {
    const gt = await handler.execute(`{ userOrders(filter: { amount: { gt: 150 } }) { amount } }`);
    expect(gt.errors).toBeUndefined();
    expect((gt.data!.userOrders as { amount: number }[]).map(r => Number(r.amount)).sort()).toEqual([200, 300]);

    const gte = await handler.execute(`{ userOrders(filter: { amount: { gte: 200 } }) { amount } }`);
    expect(gte.errors).toBeUndefined();
    expect((gte.data!.userOrders as { amount: number }[]).map(r => Number(r.amount)).sort()).toEqual([200, 300]);

    const lt = await handler.execute(`{ userOrders(filter: { amount: { lt: 200 } }) { amount } }`);
    expect(lt.errors).toBeUndefined();
    expect((lt.data!.userOrders as { amount: number }[]).map(r => Number(r.amount))).toEqual([100]);

    const lte = await handler.execute(`{ userOrders(filter: { amount: { lte: 100 } }) { amount } }`);
    expect(lte.errors).toBeUndefined();
    expect((lte.data!.userOrders as { amount: number }[]).map(r => Number(r.amount))).toEqual([100]);
  });

  it('list — filter neq excludes a numeric match', async () => {
    const result = await handler.execute(`{ userOrders(filter: { amount: { neq: 300 } }) { amount } }`);
    expect(result.errors).toBeUndefined();
    expect((result.data!.userOrders as { amount: number }[]).map(r => Number(r.amount)).sort()).toEqual([100, 200]);
  });

  it('list — multiple operators on one field AND together (range)', async () => {
    const result = await handler.execute(`{
      userOrders(filter: { amount: { gte: 150, lte: 250 } }) { name amount }
    }`);
    expect(result.errors).toBeUndefined();
    const rows = result.data!.userOrders as { name: string; amount: number }[];
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
    const ops = (result.data!.__type as { inputFields: { name: string }[] }).inputFields.map(f => f.name);
    expect(ops.sort()).toEqual(['between', 'eq', 'gt', 'gte', 'in', 'isNull', 'lt', 'lte', 'neq', 'notIn']);
  });

  it('list — filter in matches a numeric set', async () => {
    const result = await handler.execute(`{ userOrders(filter: { amount: { in: [100, 300] } }) { amount } }`);
    expect(result.errors).toBeUndefined();
    expect((result.data!.userOrders as { amount: number }[]).map(r => Number(r.amount)).sort()).toEqual([100, 300]);
  });

  it('list — filter notIn excludes a numeric set', async () => {
    const result = await handler.execute(`{ userOrders(filter: { amount: { notIn: [100] } }) { amount } }`);
    expect(result.errors).toBeUndefined();
    expect((result.data!.userOrders as { amount: number }[]).map(r => Number(r.amount)).sort()).toEqual([200, 300]);
  });

  it('list — filter isNull on a NOT NULL numeric column matches nothing', async () => {
    const isNullTrue = await handler.execute(`{ userOrders(filter: { amount: { isNull: true } }) { amount } }`);
    expect(isNullTrue.errors).toBeUndefined();
    expect((isNullTrue.data!.userOrders as unknown[]).length).toBe(0);

    const isNullFalse = await handler.execute(`{ userOrders(filter: { amount: { isNull: false } }) { amount } }`);
    expect(isNullFalse.errors).toBeUndefined();
    expect((isNullFalse.data!.userOrders as unknown[]).length).toBe(3);
  });

  it('list — filter between narrows a numeric range', async () => {
    const result = await handler.execute(`{ userOrders(filter: { amount: { between: { from: 150, to: 250 } } }) { amount } }`);
    expect(result.errors).toBeUndefined();
    expect((result.data!.userOrders as { amount: number }[]).map(r => Number(r.amount))).toEqual([200]);
  });

  it('list — nested or (an or branch containing its own or)', async () => {
    const result = await handler.execute(`{
      userOrders(filter: { or: [{ amount: { eq: 100 } }, { or: [{ amount: { eq: 200 } }, { amount: { eq: 300 } }] }] }) { amount }
    }`);
    expect(result.errors).toBeUndefined();
    expect((result.data!.userOrders as { amount: number }[]).map(r => Number(r.amount)).sort()).toEqual([100, 200, 300]);
  });

  it('list — or combinator ANDs with a sibling direct-field filter on a join', async () => {
    const result = await handler.execute(`{
      userOrders(filter: { name: { eq: "Alice" }, or: [{ amount: { eq: 100 } }, { amount: { eq: 300 } }] }) { name amount }
    }`);
    expect(result.errors).toBeUndefined();
    const rows = result.data!.userOrders as { name: string; amount: number }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Alice');
    expect(Number(rows[0].amount)).toBe(100);
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
      userOrdersCount(filter: { name: { eq: "Alice" } })
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

  it('list result — count ignores limit/offset on a JoinQuerySet', async () => {
    const result = await handler.execute(`{
      userOrdersList(limit: 1, offset: 1) { count values { name amount } }
    }`);
    expect(result.errors).toBeUndefined();
    const list = result.data!.userOrdersList as { count: number; values: unknown[] };
    expect(list.count).toBe(3);
    expect(list.values).toHaveLength(1);
  });

  it('multiple requests do not accumulate filter state', async () => {
    await handler.execute(`{ userOrders(filter: { name: { eq: "Alice" } }) { name } }`);
    const result = await handler.execute(`{ userOrders { name } }`);
    expect(result.errors).toBeUndefined();
    expect((result.data!.userOrders as unknown[]).length).toBe(3);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// LeftJoin (users LEFT JOIN orders) — some users have no matching orders
// ══════════════════════════════════════════════════════════════════════════

describe('QuerySetGraphQLHandler — LeftJoin (dblink-pg)', () => {
  let handler: QuerySetGraphQLHandler<UserRow & OrderRow>;

  beforeAll(async () => {
    await ensureCtx();
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
  let handler: QuerySetGraphQLHandler<Pick<UserRow & OrderRow, 'name' | 'amount'>>;

  beforeAll(async () => {
    await ensureCtx();
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

// ══════════════════════════════════════════════════════════════════════════
// Scale — 100 rows per table, every operator cross-checked against JS-computed
// expectations (not just "did it error"). The small fixtures above prove the
// wiring; this proves it holds up with realistic volume and hit-counts.
// ══════════════════════════════════════════════════════════════════════════

@Table('gql_scale_users')
class ScaleUser {
  @Id @Column('id') id: number = 0;
  @Column('name') name: string = '';
  @Column('email') email: string = '';
  @Column('active') active: boolean = true;
}

@Table('gql_scale_orders')
class ScaleOrder {
  @Id @Column('order_id') orderId: number = 0;
  @Column('user_id') userId: number = 0;
  // Intentionally `number`, not `number | null`, even though the column is
  // nullable: a union annotation breaks TS's emitDecoratorMetadata (it can't
  // emit a single constructor for a union type), which silently degrades
  // this field to a StringFilter instead of a FloatFilter. The static type
  // is a (harmless) lie — dblink never validates against it at runtime, so
  // real null values still flow through correctly for the isNull tests below.
  @Column('amount') amount: number = 0;
}

class ScaleAppContext extends Context {
  users = new collection.TableSet(ScaleUser);
  orders = new collection.TableSet(ScaleOrder);
}

const SCALE_NAMES = ['Alice', 'Bob', 'Carol', 'Dave', 'Eve', 'Frank', 'Grace', 'Heidi', 'Ivan', 'Judy'];

type ScaleUserRow = { id: number; name: string; email: string | null; active: boolean };
type ScaleOrderRow = { orderId: number; userId: number; amount: number | null };

const scaleUsers: ScaleUserRow[] = Array.from({ length: 100 }, (_, i) => {
  const idx = i + 1;
  return {
    id: idx,
    name: SCALE_NAMES[i % SCALE_NAMES.length],
    email: idx % 7 === 0 ? null : `user${idx}@example.com`,
    active: idx % 2 === 0
  };
});

const scaleOrders: ScaleOrderRow[] = Array.from({ length: 100 }, (_, i) => {
  const idx = i + 1;
  return {
    orderId: idx,
    userId: ((idx - 1) % 100) + 1,
    amount: idx % 5 === 0 ? null : Math.round(idx * 3.7 * 100) / 100
  };
});

async function scaleIds(handler: QuerySetGraphQLHandler<object>, field: string, query: string): Promise<number[]> {
  const result = await handler.execute(query);
  expect(result.errors).toBeUndefined();
  const key = Object.keys(result.data!)[0];
  return (result.data![key] as Record<string, unknown>[]).map(r => Number(r[field]));
}

function expectIds(actual: number[], expected: number[]) {
  expect([...actual].sort((a, b) => a - b)).toEqual([...expected].sort((a, b) => a - b));
}

describe('Scale — 100 rows per table, every operator cross-checked against JS-computed expectations', () => {
  let scaleCtx: ScaleAppContext;
  let scaleUserHandler: QuerySetGraphQLHandler<ScaleUserRow>;
  let scaleOrderHandler: QuerySetGraphQLHandler<ScaleOrderRow>;

  beforeAll(async () => {
    await ensureCtx(); // reuses the shared `pg` connection, guarantees pg.init() has run

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

  // ── User (String / Boolean / ID) ───────────────────────────────────────

  it('eq (name)', async () => {
    expectIds(
      await scaleIds(scaleUserHandler, 'id', `{ users(filter: { name: { eq: "Alice" } }) { id } }`),
      scaleUsers.filter(u => u.name === 'Alice').map(u => u.id)
    );
  });

  it('neq (name)', async () => {
    expectIds(
      await scaleIds(scaleUserHandler, 'id', `{ users(filter: { name: { neq: "Alice" } }) { id } }`),
      scaleUsers.filter(u => u.name !== 'Alice').map(u => u.id)
    );
  });

  it('like (email contains a digit)', async () => {
    expectIds(
      await scaleIds(scaleUserHandler, 'id', `{ users(filter: { email: { like: "%3%" } }) { id } }`),
      scaleUsers.filter(u => u.email !== null && u.email.includes('3')).map(u => u.id)
    );
  });

  it('in (name)', async () => {
    expectIds(
      await scaleIds(scaleUserHandler, 'id', `{ users(filter: { name: { in: ["Alice", "Bob"] } }) { id } }`),
      scaleUsers.filter(u => u.name === 'Alice' || u.name === 'Bob').map(u => u.id)
    );
  });

  it('notIn (name)', async () => {
    expectIds(
      await scaleIds(scaleUserHandler, 'id', `{ users(filter: { name: { notIn: ["Alice", "Bob"] } }) { id } }`),
      scaleUsers.filter(u => u.name !== 'Alice' && u.name !== 'Bob').map(u => u.id)
    );
  });

  it('isNull true (email)', async () => {
    expectIds(
      await scaleIds(scaleUserHandler, 'id', `{ users(filter: { email: { isNull: true } }) { id } }`),
      scaleUsers.filter(u => u.email === null).map(u => u.id)
    );
  });

  it('isNull false (email)', async () => {
    expectIds(
      await scaleIds(scaleUserHandler, 'id', `{ users(filter: { email: { isNull: false } }) { id } }`),
      scaleUsers.filter(u => u.email !== null).map(u => u.id)
    );
  });

  it('eq (active boolean)', async () => {
    expectIds(
      await scaleIds(scaleUserHandler, 'id', `{ users(filter: { active: { eq: true } }) { id } }`),
      scaleUsers.filter(u => u.active === true).map(u => u.id)
    );
  });

  it('in (active boolean)', async () => {
    expectIds(
      await scaleIds(scaleUserHandler, 'id', `{ users(filter: { active: { in: [true] } }) { id } }`),
      scaleUsers.filter(u => u.active === true).map(u => u.id)
    );
  });

  it('or (name eq Alice OR name eq Bob)', async () => {
    expectIds(
      await scaleIds(scaleUserHandler, 'id', `{ users(filter: { or: [{ name: { eq: "Alice" } }, { name: { eq: "Bob" } }] }) { id } }`),
      scaleUsers.filter(u => u.name === 'Alice' || u.name === 'Bob').map(u => u.id)
    );
  });

  it('nested or (Alice OR (Bob OR Carol))', async () => {
    expectIds(
      await scaleIds(scaleUserHandler, 'id', `{ users(filter: { or: [{ name: { eq: "Alice" } }, { or: [{ name: { eq: "Bob" } }, { name: { eq: "Carol" } }] }] }) { id } }`),
      scaleUsers.filter(u => u.name === 'Alice' || u.name === 'Bob' || u.name === 'Carol').map(u => u.id)
    );
  });

  it('or ANDs with a sibling direct-field filter (active=true AND (Alice OR Bob))', async () => {
    expectIds(
      await scaleIds(scaleUserHandler, 'id', `{ users(filter: { active: { eq: true }, or: [{ name: { eq: "Alice" } }, { name: { eq: "Bob" } }] }) { id } }`),
      scaleUsers.filter(u => u.active === true && (u.name === 'Alice' || u.name === 'Bob')).map(u => u.id)
    );
  });

  it('in (IDFilter)', async () => {
    expectIds(
      await scaleIds(scaleUserHandler, 'id', `{ users(filter: { id: { in: ["1", "2", "3"] } }) { id } }`),
      scaleUsers.filter(u => [1, 2, 3].includes(u.id)).map(u => u.id)
    );
  });

  // ── Order (Float, with real null values) ───────────────────────────────

  it('gt (amount)', async () => {
    expectIds(
      await scaleIds(scaleOrderHandler, 'orderId', `{ orders(filter: { amount: { gt: 200 } }) { orderId } }`),
      scaleOrders.filter(o => o.amount !== null && o.amount > 200).map(o => o.orderId)
    );
  });

  it('gte (amount)', async () => {
    expectIds(
      await scaleIds(scaleOrderHandler, 'orderId', `{ orders(filter: { amount: { gte: 200 } }) { orderId } }`),
      scaleOrders.filter(o => o.amount !== null && o.amount >= 200).map(o => o.orderId)
    );
  });

  it('lt (amount)', async () => {
    expectIds(
      await scaleIds(scaleOrderHandler, 'orderId', `{ orders(filter: { amount: { lt: 100 } }) { orderId } }`),
      scaleOrders.filter(o => o.amount !== null && o.amount < 100).map(o => o.orderId)
    );
  });

  it('lte (amount)', async () => {
    expectIds(
      await scaleIds(scaleOrderHandler, 'orderId', `{ orders(filter: { amount: { lte: 100 } }) { orderId } }`),
      scaleOrders.filter(o => o.amount !== null && o.amount <= 100).map(o => o.orderId)
    );
  });

  it('neq (amount)', async () => {
    expectIds(
      await scaleIds(scaleOrderHandler, 'orderId', `{ orders(filter: { amount: { neq: 100 } }) { orderId } }`),
      scaleOrders.filter(o => o.amount !== null && o.amount !== 100).map(o => o.orderId)
    );
  });

  it('between (amount 100-300)', async () => {
    expectIds(
      await scaleIds(scaleOrderHandler, 'orderId', `{ orders(filter: { amount: { between: { from: 100, to: 300 } } }) { orderId } }`),
      scaleOrders.filter(o => o.amount !== null && o.amount >= 100 && o.amount <= 300).map(o => o.orderId)
    );
  });

  it('in with an empty list matches nothing', async () => {
    expectIds(await scaleIds(scaleOrderHandler, 'orderId', `{ orders(filter: { amount: { in: [] } }) { orderId } }`), []);
  });

  it('notIn with an empty list matches everything', async () => {
    expectIds(
      await scaleIds(scaleOrderHandler, 'orderId', `{ orders(filter: { amount: { notIn: [] } }) { orderId } }`),
      scaleOrders.map(o => o.orderId)
    );
  });

  it('in (amount)', async () => {
    const sample = [scaleOrders[0].amount, scaleOrders[1].amount, scaleOrders[2].amount].filter((a): a is number => a !== null);
    expectIds(
      await scaleIds(scaleOrderHandler, 'orderId', `{ orders(filter: { amount: { in: [${sample.join(', ')}] } }) { orderId } }`),
      scaleOrders.filter(o => o.amount !== null && sample.includes(o.amount)).map(o => o.orderId)
    );
  });

  it('notIn (amount)', async () => {
    const sample = [scaleOrders[0].amount, scaleOrders[1].amount, scaleOrders[2].amount].filter((a): a is number => a !== null);
    expectIds(
      await scaleIds(scaleOrderHandler, 'orderId', `{ orders(filter: { amount: { notIn: [${sample.join(', ')}] } }) { orderId } }`),
      scaleOrders.filter(o => o.amount !== null && !sample.includes(o.amount)).map(o => o.orderId)
    );
  });

  it('isNull true (amount) — real numeric null test, not achievable with the NOT NULL fixture above', async () => {
    expectIds(
      await scaleIds(scaleOrderHandler, 'orderId', `{ orders(filter: { amount: { isNull: true } }) { orderId } }`),
      scaleOrders.filter(o => o.amount === null).map(o => o.orderId)
    );
  });

  it('isNull false (amount)', async () => {
    expectIds(
      await scaleIds(scaleOrderHandler, 'orderId', `{ orders(filter: { amount: { isNull: false } }) { orderId } }`),
      scaleOrders.filter(o => o.amount !== null).map(o => o.orderId)
    );
  });

  it('or (amount eq X OR amount eq Y)', async () => {
    expectIds(
      await scaleIds(scaleOrderHandler, 'orderId', `{ orders(filter: { or: [{ amount: { eq: ${scaleOrders[0].amount} } }, { amount: { eq: ${scaleOrders[1].amount} } }] }) { orderId } }`),
      scaleOrders.filter(o => o.amount === scaleOrders[0].amount || o.amount === scaleOrders[1].amount).map(o => o.orderId)
    );
  });

  it('nested or on amount', async () => {
    expectIds(
      await scaleIds(
        scaleOrderHandler,
        'orderId',
        `{ orders(filter: { or: [{ amount: { eq: ${scaleOrders[0].amount} } }, { or: [{ amount: { eq: ${scaleOrders[1].amount} } }, { amount: { eq: ${scaleOrders[2].amount} } }] }] }) { orderId } }`
      ),
      scaleOrders.filter(o => o.amount === scaleOrders[0].amount || o.amount === scaleOrders[1].amount || o.amount === scaleOrders[2].amount).map(o => o.orderId)
    );
  });

  it('or ANDs with a sibling range filter', async () => {
    expectIds(
      await scaleIds(scaleOrderHandler, 'orderId', `{ orders(filter: { amount: { gte: 0, lte: 400 }, or: [{ userId: { eq: 1 } }, { userId: { eq: 2 } }] }) { orderId } }`),
      scaleOrders.filter(o => o.amount !== null && o.amount >= 0 && o.amount <= 400 && (o.userId === 1 || o.userId === 2)).map(o => o.orderId)
    );
  });
});

// Drop test tables and end the pg pool once all suites have finished
afterAll(async () => {
  await pg.run('DROP TABLE IF EXISTS orders_gql_test');
  await pg.run('DROP TABLE IF EXISTS gql_test_users');
  await pg.connectionPool.end();
});
