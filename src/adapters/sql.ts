import type { StoredFlag, SyncFlagStore } from '../types';

/**
 * Structural driver contract for a synchronous SQL client (better-sqlite3,
 * raw `sqlite3`-style drivers, etc). We never import a specific driver
 * package — inject it.
 */
export interface SqlDriver {
  all(sql: string, params?: unknown[]): Array<{ key: string; enabled: number | boolean }>;
  run(sql: string, params?: unknown[]): void;
}

export interface SqlFlagStoreOptions {
  /** Table name. Default `'feature_flags'`. */
  table?: string;
}

const DEFAULT_TABLE = 'feature_flags';

/**
 * Apps own their migration explicitly — this store never auto-creates the
 * table. Use this as (or adapt it into) that migration.
 */
export const FEATURE_FLAGS_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS feature_flags (
  key TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL
);`;

const VALID_TABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function assertValidTable(table: string): void {
  if (!VALID_TABLE_NAME.test(table)) {
    throw new Error(`createSqlFlagStore: invalid table name "${table}"`);
  }
}

/**
 * A `SyncFlagStore` over a synchronous SQL driver. `seedMissing` issues an
 * atomic `INSERT ... ON CONFLICT(key) DO NOTHING` per flag so it can never
 * clobber an existing value with the registry default.
 */
export function createSqlFlagStore(driver: SqlDriver, options: SqlFlagStoreOptions = {}): SyncFlagStore {
  const table = options.table ?? DEFAULT_TABLE;
  assertValidTable(table);

  return {
    load(): StoredFlag[] {
      const rows = driver.all(`SELECT key, enabled FROM ${table}`);
      return rows.map((row) => ({ key: row.key, enabled: Boolean(row.enabled) }));
    },
    set(key: string, enabled: boolean): void {
      driver.run(
        `INSERT INTO ${table} (key, enabled) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET enabled = excluded.enabled`,
        [key, enabled ? 1 : 0],
      );
    },
    seedMissing(flags: readonly StoredFlag[]): void {
      for (const flag of flags) {
        driver.run(`INSERT INTO ${table} (key, enabled) VALUES (?, ?) ON CONFLICT(key) DO NOTHING`, [
          flag.key,
          flag.enabled ? 1 : 0,
        ]);
      }
    },
  };
}
