import type { SyncFlagStore } from '../types';
/**
 * Structural driver contract for a synchronous SQL client (better-sqlite3,
 * raw `sqlite3`-style drivers, etc). We never import a specific driver
 * package — inject it.
 */
export interface SqlDriver {
    all(sql: string, params?: unknown[]): Array<{
        key: string;
        enabled: number | boolean;
    }>;
    run(sql: string, params?: unknown[]): void;
}
export interface SqlFlagStoreOptions {
    /** Table name. Default `'feature_flags'`. */
    table?: string;
}
/**
 * Apps own their migration explicitly — this store never auto-creates the
 * table. Use this as (or adapt it into) that migration.
 */
export declare const FEATURE_FLAGS_SCHEMA_SQL = "CREATE TABLE IF NOT EXISTS feature_flags (\n  key TEXT PRIMARY KEY,\n  enabled INTEGER NOT NULL\n);";
/**
 * A `SyncFlagStore` over a synchronous SQL driver. `seedMissing` issues an
 * atomic `INSERT ... ON CONFLICT(key) DO NOTHING` per flag so it can never
 * clobber an existing value with the registry default.
 */
export declare function createSqlFlagStore(driver: SqlDriver, options?: SqlFlagStoreOptions): SyncFlagStore;
