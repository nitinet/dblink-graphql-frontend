# dblink-graphql-frontend

Auto-generates a GraphQL execution layer from [dblink](https://github.com/nitinjs/dblink) `TableSet`, `QuerySet`, and `JoinQuerySet` — no manual schema definition required.

![Version](https://img.shields.io/badge/version-1.0.0-blue)
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
    users(filter: { name: "Alice" }, limit: 10) {
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
{ userOrders(filter: { name: "Alice" }) { name amount } }

# Order by a field from the right table
{ userOrders(orderBy: { field: "amount", direction: DESC }) { name amount } }

# Paginate
{ userOrders(limit: 10, offset: 20) { name amount } }

# Count
{ userOrdersCount }
{ userOrdersCount(filter: { name: "Alice" }) }

# Count + rows together
{ userOrdersList { count values { name amount } } }
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
| `NameFilter` | Input type for equality filtering |
| `NameOrderBy` | Input type `{ field: String!, direction: ASC \| DESC }` |
| `NameList` | Result type `{ count: Int!, values: [Name!]! }` |
| `names` | List query with `filter`, `orderBy`, `limit`, `offset` args |
| `namesCount` | Count query with optional `filter` arg |
| `namesList` | Combined count + list query |

## Introspection

Both handlers support full GraphQL introspection. The generated `GraphQLSchema` instance can be passed directly to any GraphQL HTTP middleware (Apollo Server, `graphql-http`, etc.).

```typescript
const schema = handler.getSchema(); // GraphQLSchema instance
```

## License

ISC
