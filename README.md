# dblink-graphql-frontend

Auto-generates a GraphQL execution layer from [dblink](https://github.com/nitinjs/dblink) `TableSet`, `QuerySet`, and `JoinQuerySet` — no manual schema definition required.

![Version](https://img.shields.io/badge/version-1.0.2-blue)
![License](https://img.shields.io/badge/license-ISC-green)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-blue)

## Installation

```bash
npm install dblink-graphql-frontend
```

Requires `dblink` and a database adapter (e.g. `dblink-pg`) to be installed separately.

## Overview

The library exports two classes:

| Class | Purpose |
|---|---|
| `GraphQLHandler` | Wraps a full dblink `Context` and exposes every registered `TableSet` as a GraphQL query field. |
| `QuerySetGraphQLHandler` | Wraps a single `IQuerySet` (`TableSet`, `QuerySet`, or `JoinQuerySet`) and exposes a focused GraphQL schema for that queryset. |

Both classes auto-derive the GraphQL schema from entity metadata — field types, primary keys, and selected columns are all reflected automatically.

## Usage

### `GraphQLHandler` — full context

```typescript
import { GraphQLHandler } from 'dblink-graphql-frontend';
import { Context, collection, decorators } from 'dblink';
import PgDbLink from 'dblink-pg';

const { Table, Column, Id } = decorators;

@Table('users')
class User {
  @Id @Column('id') id = 0;
  @Column('name') name = '';
  @Column('email') email = '';
}

class AppContext extends Context {
  users = new collection.TableSet(User);
}

const ctx = new AppContext(new PgDbLink({ host: 'localhost', ... }));
await ctx.init();

const handler = new GraphQLHandler(ctx);

const result = await handler.execute(`
  query {
    users(filter: { name: { eq: "Alice" } }, limit: 10) {
      id name email
    }
  }
`);
```

### `QuerySetGraphQLHandler` — single queryset

```typescript
import { QuerySetGraphQLHandler } from 'dblink-graphql-frontend';

// Full table
const handler = new QuerySetGraphQLHandler(ctx.users, 'User');

// Pre-filtered queryset
const activeOnly = ctx.users.where(eb => eb.eq('status', 'active'));
const handler = new QuerySetGraphQLHandler(activeOnly, 'ActiveUser');

// Column-narrowed queryset
const summary = ctx.users.select(['id', 'name']);
const handler = new QuerySetGraphQLHandler(summary, 'UserSummary');
```

### Join Query Support

`QuerySetGraphQLHandler` fully supports `JoinQuerySet`s produced by `.join()` on a `TableSet` or `QuerySet`. The schema is automatically derived from the combined fields of both sides of the join.

```typescript
import { QuerySetGraphQLHandler } from 'dblink-graphql-frontend';
import { Context, collection, decorators } from 'dblink';

const { Table, Column, Id } = decorators;

@Table('users')
class User {
  @Id @Column('id') id = 0;
  @Column('name') name = '';
  @Column('email') email = '';
}

@Table('orders')
class Order {
  @Id @Column('order_id') orderId = 0;
  @Column('user_id') userId = 0;
  @Column('amount') amount = 0;
}

class AppContext extends Context {
  users = new collection.TableSet(User);
  orders = new collection.TableSet(Order);
}

const ctx = new AppContext(pg);
await ctx.init();

// Inner join: users JOIN orders ON users.id = orders.user_id
const joinQS = ctx.users.join(ctx.orders, (u, o) => u.eq('id', o.col('userId')));
const handler = new QuerySetGraphQLHandler(joinQS, 'UserOrder');
```

When field names overlap between the two tables, the right-hand table's mapping wins.

**Generated schema** (for name `'UserOrder'`):

```graphql
type Query {
  userOrders(filter: UserOrderFilter, orderBy: UserOrderOrderBy, limit: Int, offset: Int): [UserOrder!]!
  userOrdersCount(filter: UserOrderFilter): Int!
  userOrdersList(filter: UserOrderFilter, orderBy: UserOrderOrderBy, limit: Int, offset: Int): UserOrderList!
}

type UserOrder {
  id: ID        # from User
  name: String  # from User
  email: String # from User
  orderId: ID   # from Order
  userId: Float # from Order
  amount: Float # from Order
}
```

**Example queries:**

```graphql
# List all joined rows
{ userOrders { id name amount } }

# Filter on a field from either table
{ userOrders(filter: { name: { eq: "Alice" } }) { name amount } }

# Order by a field from the right table
{ userOrders(orderBy: { field: "amount", direction: DESC }) { name amount } }

# Paginate
{ userOrders(limit: 10, offset: 20) { name amount } }

# Count
{ userOrdersCount }
{ userOrdersCount(filter: { name: { eq: "Alice" } }) }

# Count + rows together
{ userOrdersList { count values { name amount } } }

# count is the total matching row count, independent of limit/offset —
# use it to compute total pages even when only fetching one page of rows
{ userOrdersList(limit: 10, offset: 20) { count values { name amount } } }
```

**Left join:**

```typescript
import { core } from 'dblink';

const leftJoinQS = ctx.users.join(
  ctx.orders,
  (u, o) => u.eq('id', o.col('userId')),
  core.sql.types.Join.LeftJoin   // optional, defaults to InnerJoin
);
const handler = new QuerySetGraphQLHandler(leftJoinQS, 'UserOrderLeft');
```

**Narrowing join results with `select()`:**

```typescript
const narrowedJoin = ctx.users
  .join(ctx.orders, (u, o) => u.eq('id', o.col('userId')))
  .select(['name', 'amount']);
const handler = new QuerySetGraphQLHandler(narrowedJoin, 'UserOrderSummary');
```

## Auto-generated schema conventions

For every queryset registered under name `Name`, the following types and query fields are generated:

| Generated | Description |
|---|---|
| `Name` | Object type with all exposed fields |
| `NameFilter` | Input type mapping each field to its `{Scalar}Filter` operator input, plus self-referential `and`/`or` fields |
| `FloatFilter` / `IntFilter` | `{ eq, neq, gt, gte, lt, lte, in, notIn, between, isNull }` — numeric fields |
| `StringFilter` | `{ eq, neq, like, in, notIn, isNull }` — string fields (no ordering, no `between`) |
| `BooleanFilter` / `IDFilter` | `{ eq, neq, in, notIn, isNull }` — no ordering, no `like`, no `between` |
| `{Scalar}Range` | Input type `{ from: Scalar!, to: Scalar! }` — the value type for `between` |
| `NameOrderBy` | Input type `{ field: String!, direction: ASC \| DESC }` |
| `NameList` | Result type `{ count: Int!, values: [Name!]! }` — `count` is the total row count matching `filter`, independent of `limit`/`offset` (it is not the number of rows in `values`) |
| `names` | List query with `filter`, `orderBy`, `limit`, `offset` args |
| `namesCount` | Count query with optional `filter` arg |
| `namesList` | Combined count + list query |

### Filtering

Every filter field takes an operator object rather than a bare scalar. Multiple
operators on the same field are ANDed together:

```graphql
{ users(filter: { name: { eq: "Alice" } }) { id name } }
{ users(filter: { email: { like: "%@example.com" } }) { id name } }
{ users(filter: { age: { gte: 18, lte: 65 } }) { id name } }
```

**Operators:**

| Operator | Types | Value | Example |
| --- | --- | --- | --- |
| `eq`, `neq` | all | scalar | `{ status: { eq: "active" } }` |
| `gt`, `gte`, `lt`, `lte` | numeric | scalar | `{ age: { gte: 18 } }` |
| `like` | String | scalar | `{ email: { like: "%@example.com" } }` |
| `in`, `notIn` | all | list of scalar | `{ status: { in: ["A", "B"] } }` |
| `between` | numeric | `{ from, to }` | `{ age: { between: { from: 18, to: 65 } } }` |
| `isNull` | all | Boolean flag | `{ email: { isNull: true } }` (use `isNull: false` for "is not null") |

`notIn` composes `in(...)` with a `NOT (...)` wrapper; there's no dedicated `notIn`
SQL builder method under the hood, but the GraphQL-facing operator works the same
as a native one.

**`and` / `or` — combining filters explicitly:**

Every `{Name}Filter` also accepts `and` and `or` fields: arrays of nested filter
objects (same shape, recursively). A filter object's own direct fields AND
together; its `and` branches AND in (redundant with just merging fields into
one object, on its own); its `or` branches OR together; all three results AND:

```graphql
# name = "Alice" OR name = "Bob"
{ users(filter: { or: [{ name: { eq: "Alice" } }, { name: { eq: "Bob" } }] }) { id name } }

# email LIKE "%@example.com" AND (name = "Alice" OR name = "Bob")
{ users(filter: {
    email: { like: "%@example.com" }
    or: [{ name: { eq: "Alice" } }, { name: { eq: "Bob" } }]
  }) { id name } }

# and/or branches can nest arbitrarily
{ users(filter: { or: [
    { name: { eq: "Alice" } },
    { or: [{ name: { eq: "Bob" } }, { name: { eq: "Carol" } }] }
  ] }) { id name } }

# and is where it earns its keep: combining two independent or-groups that a
# single filter object (only one `or` field) can't express directly.
# (name = "Alice" OR name = "Bob") AND (status = "active" OR status = "pending")
{ users(filter: { and: [
    { or: [{ name: { eq: "Alice" } }, { name: { eq: "Bob" } }] },
    { or: [{ status: { eq: "active" } }, { status: { eq: "pending" } }] }
  ] }) { id name } }
```

**Typing `filter` on the consuming side:** the package exports a generic `Filter<T>`
type mirroring the `{Name}Filter` shape above for any entity `T`, so callers that
build/accept filter objects outside of a raw GraphQL query string (e.g. a REST
endpoint that forwards its body straight into a `filter` variable) don't have to
duplicate this shape by hand:

```typescript
import type { Filter } from 'dblink-graphql-frontend';
import User from './entities/User.js';

type UserFilter = Filter<User>; // same shape as the generated UserFilter GraphQL input type
```

## Introspection

Both handlers support full GraphQL introspection. The generated `GraphQLSchema` instance can be passed directly to any GraphQL HTTP middleware (Apollo Server, `graphql-http`, etc.).

```typescript
const schema = handler.getSchema(); // GraphQLSchema instance
```

## License

ISC
