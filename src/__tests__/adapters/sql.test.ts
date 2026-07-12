import { describe, it, expect, vi } from 'vitest';
import { createSqlFlagStore } from '../../adapters/sql';
import type { SqlDriver } from '../../adapters/sql';

describe('createSqlFlagStore', () => {
  it('seedMissing issues an INSERT ... ON CONFLICT ... DO NOTHING for each flag', () => {
    const run = vi.fn();
    const driver: SqlDriver = { all: vi.fn(() => []), run };
    const store = createSqlFlagStore(driver);
    store.seedMissing([{ key: 'a', enabled: true }]);
    expect(run).toHaveBeenCalledTimes(1);
    const [sql, params] = run.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/INSERT INTO feature_flags/i);
    expect(sql).toMatch(/ON CONFLICT\(key\) DO NOTHING/i);
    expect(params).toEqual(['a', 1]);
  });

  it('load coerces 0/1 to booleans', () => {
    const all = vi.fn(() => [
      { key: 'a', enabled: 1 },
      { key: 'b', enabled: 0 },
    ]);
    const driver: SqlDriver = { all, run: vi.fn() };
    const store = createSqlFlagStore(driver);
    expect(store.load()).toEqual([
      { key: 'a', enabled: true },
      { key: 'b', enabled: false },
    ]);
  });

  it('set issues an UPSERT, not a DO NOTHING', () => {
    const run = vi.fn();
    const driver: SqlDriver = { all: vi.fn(() => []), run };
    const store = createSqlFlagStore(driver);
    store.set('a', false);
    const [sql, params] = run.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/ON CONFLICT\(key\) DO UPDATE/i);
    expect(params).toEqual(['a', 0]);
  });

  it('honors a custom table name', () => {
    const all = vi.fn(() => []);
    const driver: SqlDriver = { all, run: vi.fn() };
    const store = createSqlFlagStore(driver, { table: 'custom_flags' });
    store.load();
    expect(all).toHaveBeenCalledWith(expect.stringContaining('custom_flags'));
  });

  it('rejects an invalid table name', () => {
    const driver: SqlDriver = { all: vi.fn(), run: vi.fn() };
    expect(() => createSqlFlagStore(driver, { table: 'bad; drop table x' })).toThrow(/invalid table name/i);
  });
});
