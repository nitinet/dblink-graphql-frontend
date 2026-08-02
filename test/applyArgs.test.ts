import { describe, expect, it } from 'vitest';
import { applyArgs, ListArgs } from '../src/schemaBuilder.js';

/**
 * Minimal stand-in for dblink's `IQuerySet` — just enough surface for
 * `applyArgs` to drive (`where`, `orderBy`, `limit`), recording every call so
 * assertions can inspect exactly what filtering/sorting/pagination was
 * requested without needing a real database or entity metadata.
 *
 * Every `WhereExprBuilder` method returns a chainable stub supporting
 * `and`/`or`/`not` (mirroring dblink-core's `Expression`), since
 * `buildFilterExpression` combines multiple operators/fields/`or`-branches
 * via those methods before the single `where()` call.
 */
type Call =
  | { kind: 'where'; method: string; field: string; value: unknown }
  | { kind: 'orderBy'; method: 'asc' | 'desc'; field: string }
  | { kind: 'limit'; size: number; index: number | undefined }
  | { kind: 'and' }
  | { kind: 'or' }
  | { kind: 'not' };

function makeFakeQuerySet() {
  const calls: Call[] = [];

  function makeExpressionStub(): { and: () => unknown; or: () => unknown; not: () => unknown } {
    return {
      and: () => {
        calls.push({ kind: 'and' });
        return makeExpressionStub();
      },
      or: () => {
        calls.push({ kind: 'or' });
        return makeExpressionStub();
      },
      not: () => {
        calls.push({ kind: 'not' });
        return makeExpressionStub();
      }
    };
  }

  const whereExprBuilder = new Proxy(
    {},
    {
      get(_target, method: string) {
        return (field: string, ...values: unknown[]) => {
          const value = values.length === 0 ? undefined : values.length === 1 ? values[0] : values;
          calls.push({ kind: 'where', method, field, value });
          return makeExpressionStub();
        };
      }
    }
  );

  const orderExprBuilder = {
    asc(field: string) {
      calls.push({ kind: 'orderBy', method: 'asc', field });
      return {};
    },
    desc(field: string) {
      calls.push({ kind: 'orderBy', method: 'desc', field });
      return {};
    }
  };

  const qs = {
    calls,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    where(func: any) {
      func(whereExprBuilder);
      return qs;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    orderBy(func: any) {
      func(orderExprBuilder);
      return qs;
    },
    limit(size: number, index?: number) {
      calls.push({ kind: 'limit', size, index });
      return qs;
    }
  };

  return qs;
}

describe('applyArgs', () => {
  it('leaves the queryset untouched when args is empty', () => {
    const qs = makeFakeQuerySet();
    applyArgs(qs as never, {}, new Set(['name']));
    expect(qs.calls).toEqual([]);
  });

  it('applies a single filter operator', () => {
    const qs = makeFakeQuerySet();
    applyArgs(qs as never, { filter: { name: { eq: 'Alice' } } } as ListArgs, new Set(['name']));
    expect(qs.calls).toEqual([{ kind: 'where', method: 'eq', field: 'name', value: 'Alice' }]);
  });

  it('ANDs multiple operators on the same filter field', () => {
    const qs = makeFakeQuerySet();
    applyArgs(qs as never, { filter: { amount: { gte: 150, lte: 250 } } } as ListArgs, new Set(['amount']));
    expect(qs.calls).toEqual([{ kind: 'where', method: 'gteq', field: 'amount', value: 150 }, { kind: 'where', method: 'lteq', field: 'amount', value: 250 }, { kind: 'and' }]);
  });

  it('maps gte/lte to the gteq/lteq builder methods, leaving other ops untranslated', () => {
    const qs = makeFakeQuerySet();
    applyArgs(qs as never, { filter: { amount: { gt: 1, gte: 2, lt: 3, lte: 4, eq: 5, neq: 6, like: '%x%' } } } as ListArgs, new Set(['amount']));
    const methods = qs.calls.filter((c): c is { kind: 'where'; method: string; field: string; value: unknown } => c.kind === 'where').map(c => c.method);
    expect(methods).toEqual(['gt', 'gteq', 'lt', 'lteq', 'eq', 'neq', 'like']);
  });

  it('applies in with a list of values', () => {
    const qs = makeFakeQuerySet();
    applyArgs(qs as never, { filter: { name: { in: ['Alice', 'Bob'] } } } as ListArgs, new Set(['name']));
    expect(qs.calls).toEqual([{ kind: 'where', method: 'in', field: 'name', value: ['Alice', 'Bob'] }]);
  });

  it('applies notIn as in(...) followed by not()', () => {
    const qs = makeFakeQuerySet();
    applyArgs(qs as never, { filter: { name: { notIn: ['Alice', 'Bob'] } } } as ListArgs, new Set(['name']));
    expect(qs.calls).toEqual([{ kind: 'where', method: 'in', field: 'name', value: ['Alice', 'Bob'] }, { kind: 'not' }]);
  });

  it('an empty in list short-circuits to a literal predicate instead of calling eb.in() with zero values', () => {
    // Regression test: eb.in(field) with no values produces invalid SQL ("IN ()").
    // The empty case must bypass WhereExprBuilder entirely via a literal expression.
    const qs = makeFakeQuerySet();
    applyArgs(qs as never, { filter: { name: { in: [] } } } as ListArgs, new Set(['name']));
    expect(qs.calls).toEqual([]);
  });

  it('an empty notIn list short-circuits to a literal predicate instead of calling eb.in() with zero values', () => {
    const qs = makeFakeQuerySet();
    applyArgs(qs as never, { filter: { name: { notIn: [] } } } as ListArgs, new Set(['name']));
    expect(qs.calls).toEqual([]);
  });

  it('applies isNull(field) when isNull is true', () => {
    const qs = makeFakeQuerySet();
    applyArgs(qs as never, { filter: { email: { isNull: true } } } as ListArgs, new Set(['email']));
    expect(qs.calls).toEqual([{ kind: 'where', method: 'isNull', field: 'email', value: undefined }]);
  });

  it('applies isNotNull(field) when isNull is false', () => {
    const qs = makeFakeQuerySet();
    applyArgs(qs as never, { filter: { email: { isNull: false } } } as ListArgs, new Set(['email']));
    expect(qs.calls).toEqual([{ kind: 'where', method: 'isNotNull', field: 'email', value: undefined }]);
  });

  it('applies between(field, from, to)', () => {
    const qs = makeFakeQuerySet();
    applyArgs(qs as never, { filter: { amount: { between: { from: 10, to: 20 } } } } as ListArgs, new Set(['amount']));
    expect(qs.calls).toEqual([{ kind: 'where', method: 'between', field: 'amount', value: [10, 20] }]);
  });

  it('ORs branches of a top-level or array', () => {
    const qs = makeFakeQuerySet();
    applyArgs(qs as never, { filter: { or: [{ name: { eq: 'Alice' } }, { name: { eq: 'Bob' } }] } } as unknown as ListArgs, new Set(['name']));
    expect(qs.calls).toEqual([{ kind: 'where', method: 'eq', field: 'name', value: 'Alice' }, { kind: 'where', method: 'eq', field: 'name', value: 'Bob' }, { kind: 'or' }]);
  });

  it('ANDs a direct field filter with an or array', () => {
    const qs = makeFakeQuerySet();
    applyArgs(qs as never, { filter: { email: { like: '%x%' }, or: [{ name: { eq: 'Alice' } }, { name: { eq: 'Bob' } }] } } as unknown as ListArgs, new Set(['name', 'email']));
    expect(qs.calls).toEqual([
      { kind: 'where', method: 'like', field: 'email', value: '%x%' },
      { kind: 'where', method: 'eq', field: 'name', value: 'Alice' },
      { kind: 'where', method: 'eq', field: 'name', value: 'Bob' },
      { kind: 'or' },
      { kind: 'and' }
    ]);
  });

  it('an or branch that contributes nothing (all-unknown fields) is skipped', () => {
    const qs = makeFakeQuerySet();
    applyArgs(qs as never, { filter: { or: [{ secret: { eq: 'x' } }, { name: { eq: 'Alice' } }] } } as unknown as ListArgs, new Set(['name']));
    expect(qs.calls).toEqual([{ kind: 'where', method: 'eq', field: 'name', value: 'Alice' }]);
  });

  it('ignores filter fields not present in knownFields', () => {
    const qs = makeFakeQuerySet();
    applyArgs(qs as never, { filter: { secret: { eq: 'x' } } } as ListArgs, new Set(['name']));
    expect(qs.calls).toEqual([]);
  });

  it('skips a filter field whose value is undefined or null', () => {
    const qs = makeFakeQuerySet();
    applyArgs(qs as never, { filter: { name: undefined, email: null } } as unknown as ListArgs, new Set(['name', 'email']));
    expect(qs.calls).toEqual([]);
  });

  it('skips an individual operator whose value is undefined or null', () => {
    const qs = makeFakeQuerySet();
    applyArgs(qs as never, { filter: { name: { eq: undefined, neq: null, like: 'A%' } } } as unknown as ListArgs, new Set(['name']));
    expect(qs.calls).toEqual([{ kind: 'where', method: 'like', field: 'name', value: 'A%' }]);
  });

  it('applies orderBy ascending by default', () => {
    const qs = makeFakeQuerySet();
    applyArgs(qs as never, { orderBy: { field: 'name' } } as ListArgs, new Set(['name']));
    expect(qs.calls).toEqual([{ kind: 'orderBy', method: 'asc', field: 'name' }]);
  });

  it('applies orderBy descending when direction is DESC', () => {
    const qs = makeFakeQuerySet();
    applyArgs(qs as never, { orderBy: { field: 'name', direction: 'DESC' } } as ListArgs, new Set(['name']));
    expect(qs.calls).toEqual([{ kind: 'orderBy', method: 'desc', field: 'name' }]);
  });

  it('ignores orderBy on an unknown field', () => {
    const qs = makeFakeQuerySet();
    applyArgs(qs as never, { orderBy: { field: 'secret', direction: 'DESC' } } as ListArgs, new Set(['name']));
    expect(qs.calls).toEqual([]);
  });

  it('applies limit with offset', () => {
    const qs = makeFakeQuerySet();
    applyArgs(qs as never, { limit: 10, offset: 20 } as ListArgs, new Set([]));
    expect(qs.calls).toEqual([{ kind: 'limit', size: 10, index: 20 }]);
  });

  it('applies limit without offset', () => {
    const qs = makeFakeQuerySet();
    applyArgs(qs as never, { limit: 10 } as ListArgs, new Set([]));
    expect(qs.calls).toEqual([{ kind: 'limit', size: 10, index: undefined }]);
  });

  it('does not call limit when limit is absent', () => {
    const qs = makeFakeQuerySet();
    applyArgs(qs as never, { offset: 20 } as ListArgs, new Set([]));
    expect(qs.calls).toEqual([]);
  });

  it('combines filter, orderBy, and limit/offset in one call', () => {
    const qs = makeFakeQuerySet();
    applyArgs(qs as never, { filter: { name: { eq: 'Alice' } }, orderBy: { field: 'name', direction: 'DESC' }, limit: 5, offset: 1 } as ListArgs, new Set(['name']));
    expect(qs.calls).toEqual([
      { kind: 'where', method: 'eq', field: 'name', value: 'Alice' },
      { kind: 'orderBy', method: 'desc', field: 'name' },
      { kind: 'limit', size: 5, index: 1 }
    ]);
  });
});
