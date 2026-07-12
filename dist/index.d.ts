/**
 * @andrewpopov/feature-flags-kit — framework- and DB-agnostic feature flags.
 *
 * A pure evaluator (`evaluateFlags`) with a fixed precedence — store ->
 * environment -> registry default — plus two thin front ends over it:
 * `createSyncFlags` (live per-call reads, for a synchronous store like
 * better-sqlite3) and `createAsyncFlags` (an app-driven cached snapshot with
 * last-known-good degradation, for an async store like a Prisma-backed JSON
 * blob). `defineFlags` gives you a typed registry where an unknown key is a
 * compile error. Two adapters (`sql`, `blob`) are thin conveniences, not the
 * center of the package — bring your own store by implementing
 * `SyncFlagStore`/`AsyncFlagStore` directly.
 *
 * Env overrides default to `FEATURE_` + UPPER_SNAKE of the flag key (e.g.
 * `new.checkout` / `new-checkout` / `newCheckout` -> `FEATURE_NEW_CHECKOUT`),
 * both overridable via `envKey`/`parseBool` options.
 */
export type { AsyncFlagStore, EvaluatedFlag, FlagDefinition, FlagHealth, FlagSnapshot, FlagSource, StoredFlag, SyncFlagStore, } from './types';
export { evaluateFlags, defaultEnvKey, defaultParseBool, type EvaluateOptions } from './evaluate';
export { defineFlags, type FlagKeys } from './registry';
export { createSyncFlags, createAsyncFlags, type AsyncFlags, type SyncFlags, type FlagsOptions, } from './flags';
export { createSqlFlagStore, FEATURE_FLAGS_SCHEMA_SQL, type SqlDriver, type SqlFlagStoreOptions } from './adapters/sql';
export { createBlobFlagStore, type BlobDriver } from './adapters/blob';
