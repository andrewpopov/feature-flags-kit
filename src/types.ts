/** A flag as declared in code. `K` preserves the literal key union (see `defineFlags`). */
export interface FlagDefinition<K extends string = string> {
  key: K;
  description: string;
  default: boolean;
  /** What to resolve to when the STORE THROWS (not merely missing). Default 'default'. */
  onStoreError?: 'default' | 'enabled' | 'disabled';
}

/** A flag row as persisted by a store. */
export interface StoredFlag {
  key: string;
  enabled: boolean;
}

/**
 * Where an evaluated value came from. `'store-error-policy'` means the store
 * threw AND the flag's `onStoreError` is `'enabled'`/`'disabled'` — that
 * forced policy won, not the environment or registry default (even though
 * one of those may coincidentally match the resolved value).
 */
export type FlagSource = 'store' | 'environment' | 'default' | 'store-error-policy';

/** `'store-unavailable'` means the last store `load()` threw; the value is a fallback, not a real read. */
export type FlagHealth = 'ok' | 'store-unavailable';

export interface EvaluatedFlag {
  key: string;
  enabled: boolean;
  source: FlagSource;
  health: FlagHealth;
}

/**
 * An immutable, point-in-time read of every registered flag. Taking a
 * snapshot does not subscribe to future changes — mutating the underlying
 * store after `snapshot()`/`loadSnapshot()` has no effect on values already
 * handed out until the next refresh.
 */
export interface FlagSnapshot<K extends string = string> {
  isEnabled(key: K): boolean;
  get(key: K): EvaluatedFlag;
  all(): EvaluatedFlag[];
  readonly loadedAt: Date;
  /** `'store-unavailable'` if the load that produced this snapshot failed (see last-known-good in `createAsyncFlags`). */
  readonly health: FlagHealth;
}

/**
 * Synchronous store contract — e.g. better-sqlite3, or any driver that reads
 * the whole table in one call. `isEnabled` on `SyncFlags` reads through this
 * on every call (no cache), matching the sano-os model.
 */
export interface SyncFlagStore {
  load(): StoredFlag[];
  set(key: string, enabled: boolean): void;
  /** ATOMIC: insert only the keys that don't exist. MUST NOT overwrite an existing value. */
  seedMissing(flags: readonly StoredFlag[]): void;
}

/**
 * Asynchronous store contract — e.g. a Prisma/HTTP-backed store. `AsyncFlags`
 * caches the last loaded snapshot and only reloads on an explicit
 * `refresh()`/`loadSnapshot()` call.
 */
export interface AsyncFlagStore {
  load(): Promise<StoredFlag[]>;
  set(key: string, enabled: boolean): Promise<void>;
  seedMissing(flags: readonly StoredFlag[]): Promise<void>;
}
