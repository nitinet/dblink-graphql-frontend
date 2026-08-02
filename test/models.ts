import { Context, collection, decorators } from 'dblink';

const { Table, Column, Id } = decorators;

/**
 * User entity factory shared by integration tests. Table name is
 * caller-supplied so test files running concurrently never collide on the
 * same physical table.
 */
export function createUserEntity(tableName: string) {
  @Table(tableName)
  class User {
    @Id @Column('id') id: number = 0;
    @Column('name') name: string = '';
    @Column('email') email: string = '';
  }
  return User;
}

export type UserRow = InstanceType<ReturnType<typeof createUserEntity>>;

/**
 * Order entity factory shared by integration tests. Table name is
 * caller-supplied so test files running concurrently never collide on the
 * same physical table.
 */
export function createOrderEntity(tableName: string) {
  @Table(tableName)
  class Order {
    @Id @Column('order_id') orderId: number = 0;
    @Column('user_id') userId: number = 0;
    @Column('amount') amount: number = 0;
  }
  return Order;
}

export type OrderRow = InstanceType<ReturnType<typeof createOrderEntity>>;

type EntityCtor<T> = new (...args: unknown[]) => T;

/**
 * dblink Context wiring a User TableSet + an Order TableSet under
 * `users`/`orders` — the shape every integration test builds queries against.
 */
export function createAppContext<U extends object, O extends object>(UserEntity: EntityCtor<U>, OrderEntity: EntityCtor<O>) {
  class AppContext extends Context {
    users = new collection.TableSet(UserEntity);
    orders = new collection.TableSet(OrderEntity);
  }
  return AppContext;
}

/** Context with no registered TableSets — used to exercise GraphQLHandler's construction error. */
export class EmptyContext extends Context {}
