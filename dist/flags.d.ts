import { type EvaluateOptions } from './evaluate';
import type { AsyncFlagStore, EvaluatedFlag, FlagDefinition, FlagSnapshot, SyncFlagStore } from './types';
export interface FlagsOptions extends EvaluateOptions {
    /** Config source for env-override lookups. Defaults to `process.env` (or `{}` outside Node). */
    env?: Record<string, string | undefined>;
    /** Called when the store's `load()` throws. A fallback must never be silent. */
    onStoreError?: (err: unknown) => void;
}
export interface SyncFlags<K extends string = string> {
    /** Reads the store live on every call — no cache, matching the sano-os model. Never a Promise. */
    isEnabled(key: K): boolean;
    get(key: K): EvaluatedFlag;
    all(): EvaluatedFlag[];
    set(key: K, enabled: boolean): void;
    /** Seeds registry defaults for any missing key via `store.seedMissing` — never `load()`+`set()` (that's a lost-update race). */
    seed(): void;
    /** An immutable point-in-time read of every flag. */
    snapshot(): FlagSnapshot<K>;
    /** No-op: `SyncFlags` has no cache to invalidate — every read is already live. Kept for interface symmetry with `AsyncFlags`. */
    refresh(): void;
}
export interface AsyncFlags<K extends string = string> {
    /** Served from the last loaded snapshot; lazily loads one on first call. Call `refresh()` to pick up store changes. */
    isEnabled(key: K): Promise<boolean>;
    get(key: K): Promise<EvaluatedFlag>;
    all(): Promise<EvaluatedFlag[]>;
    set(key: K, enabled: boolean): Promise<void>;
    seed(): Promise<void>;
    /** Force a reload and return the resulting snapshot. See last-known-good semantics below. */
    loadSnapshot(): Promise<FlagSnapshot<K>>;
    /** Force a reload, discarding the result. */
    refresh(): Promise<void>;
    /** The last loaded snapshot, synchronously. `null` if never loaded. */
    snapshot(): FlagSnapshot<K> | null;
    /** `loadedAt` of the last loaded snapshot, or `null` if never loaded. */
    readonly loadedAt: Date | null;
}
/**
 * Create a `SyncFlags` front end backed by a `SyncFlagStore` (e.g. the
 * `sql` adapter over better-sqlite3). Every read calls `store.load()` — no
 * cache — so a toggle written elsewhere is visible on the very next call.
 *
 * On `load()` throwing: does NOT propagate. `options.onStoreError` fires,
 * and evaluation proceeds with `stored = null` (per-flag `onStoreError`
 * policy + degraded `health` apply). `set()`/`seed()` errors DO propagate —
 * a failed admin write must be loud.
 */
export declare function createSyncFlags<K extends string>(registry: readonly FlagDefinition<K>[], store: SyncFlagStore, options?: FlagsOptions): SyncFlags<K>;
/**
 * Create an `AsyncFlags` front end backed by an `AsyncFlagStore` (e.g. the
 * `blob` adapter over a single Prisma JSON row). Caches the last loaded
 * snapshot; `isEnabled`/`get`/`all` lazily load once and then serve from
 * that cache until an explicit `refresh()`/`loadSnapshot()` — there is NO
 * implicit/hidden TTL.
 *
 * Last-known-good: if a reload fails (`load()` throws) after a previous
 * reload succeeded, the OLD values keep being served, but the snapshot's
 * `health` reports `'store-unavailable'` so callers can detect degradation.
 * If a reload fails and nothing has ever loaded successfully, evaluation
 * falls back to `stored = null` semantics (per-flag `onStoreError` + env +
 * registry default), same as the sync front end.
 *
 * `set()`/`seed()` errors DO propagate — a failed admin write must be loud.
 */
export declare function createAsyncFlags<K extends string>(registry: readonly FlagDefinition<K>[], store: AsyncFlagStore, options?: FlagsOptions): AsyncFlags<K>;
