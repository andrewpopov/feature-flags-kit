import { evaluateFlags, type EvaluateOptions } from './evaluate';
import type {
  AsyncFlagStore,
  EvaluatedFlag,
  FlagDefinition,
  FlagHealth,
  FlagSnapshot,
  StoredFlag,
  SyncFlagStore,
} from './types';

function resolveEnv(env?: Record<string, string | undefined>): Record<string, string | undefined> {
  if (env) return env;
  return typeof process !== 'undefined' ? process.env : {};
}

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

function requireFlag<K extends string>(map: ReadonlyMap<string, EvaluatedFlag>, key: K): EvaluatedFlag {
  const flag = map.get(key);
  if (!flag) throw new Error(`Unknown feature flag: "${key}"`);
  return flag;
}

/** Defensive clone so a caller mutating a returned record can never reach (or poison) internal state. */
function freezeFlag(flag: EvaluatedFlag): EvaluatedFlag {
  return Object.freeze({ ...flag });
}

/**
 * Builds an immutable point-in-time `FlagSnapshot`. `get`/`all` always
 * return frozen clones — never the internal records — so a caller mutating
 * a returned object can neither corrupt a later snapshot nor poison
 * retained last-known-good state. `loadedAt` is stored as a number
 * internally and exposed via a getter that mints a fresh `Date` each read.
 */
function toSnapshot<K extends string>(
  map: ReadonlyMap<string, EvaluatedFlag>,
  loadedAtMs: number,
  health: FlagHealth,
): FlagSnapshot<K> {
  return {
    isEnabled: (key: K) => requireFlag(map, key).enabled,
    get: (key: K) => freezeFlag(requireFlag(map, key)),
    all: () => Array.from(map.values(), freezeFlag),
    get loadedAt(): Date {
      return new Date(loadedAtMs);
    },
    health,
  };
}

function healthOf(map: ReadonlyMap<string, EvaluatedFlag>): FlagHealth {
  for (const flag of map.values()) {
    if (flag.health === 'store-unavailable') return 'store-unavailable';
  }
  return 'ok';
}

/**
 * Returns a NEW map with every record's `enabled`/`source` retained but
 * `health` forced to `'store-unavailable'`. Never mutates the input map —
 * the retained last-known-good state must stay exactly as it was when it
 * was last a successful read.
 */
function degradeHealth(map: ReadonlyMap<string, EvaluatedFlag>): Map<string, EvaluatedFlag> {
  const next = new Map<string, EvaluatedFlag>();
  for (const [key, flag] of map) {
    next.set(key, { ...flag, health: 'store-unavailable' });
  }
  return next;
}

function seedFlags<K extends string>(registry: readonly FlagDefinition<K>[]): StoredFlag[] {
  return registry.map((def) => ({ key: def.key, enabled: def.default }));
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
export function createSyncFlags<K extends string>(
  registry: readonly FlagDefinition<K>[],
  store: SyncFlagStore,
  options: FlagsOptions = {},
): SyncFlags<K> {
  const env = resolveEnv(options.env);
  const evalOptions: EvaluateOptions = { envKey: options.envKey, parseBool: options.parseBool };

  function evaluate(): Map<string, EvaluatedFlag> {
    let stored: StoredFlag[] | null;
    try {
      stored = store.load();
    } catch (err) {
      options.onStoreError?.(err);
      stored = null;
    }
    return evaluateFlags(registry, stored, env, evalOptions);
  }

  return {
    isEnabled: (key) => requireFlag(evaluate(), key).enabled,
    get: (key) => freezeFlag(requireFlag(evaluate(), key)),
    all: () => Array.from(evaluate().values(), freezeFlag),
    set: (key, enabled) => store.set(key, enabled),
    seed: () => store.seedMissing(seedFlags(registry)),
    snapshot: () => {
      const map = evaluate();
      return toSnapshot<K>(map, Date.now(), healthOf(map));
    },
    refresh: () => {
      // Intentional no-op — see the `refresh` doc comment on `SyncFlags`.
    },
  };
}

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
export function createAsyncFlags<K extends string>(
  registry: readonly FlagDefinition<K>[],
  store: AsyncFlagStore,
  options: FlagsOptions = {},
): AsyncFlags<K> {
  const env = resolveEnv(options.env);
  const evalOptions: EvaluateOptions = { envKey: options.envKey, parseBool: options.parseBool };

  let lastGoodMap: Map<string, EvaluatedFlag> | null = null;
  let lastGoodLoadedAtMs: number | null = null;
  let currentSnapshot: FlagSnapshot<K> | null = null;

  // Monotonic request id so overlapping refreshes can't commit out of order:
  // a slow-to-resolve older refresh must never overwrite a newer one that
  // already landed. Only the call whose id is still the newest issued at
  // the time it resolves is allowed to write `currentSnapshot`/`lastGoodMap`.
  let requestSeq = 0;

  async function doRefresh(): Promise<FlagSnapshot<K>> {
    const requestId = ++requestSeq;

    let stored: StoredFlag[] | null;
    try {
      stored = await store.load();
    } catch (err) {
      options.onStoreError?.(err);
      stored = null;
    }

    const isNewest = requestId === requestSeq;

    if (stored !== null) {
      const evaluated = evaluateFlags(registry, stored, env, evalOptions);
      const loadedAtMs = Date.now();
      const snap = toSnapshot<K>(evaluated, loadedAtMs, 'ok');
      if (isNewest) {
        lastGoodMap = evaluated;
        lastGoodLoadedAtMs = loadedAtMs;
        currentSnapshot = snap;
      }
      return snap;
    }

    if (lastGoodMap && lastGoodLoadedAtMs !== null) {
      // Retain last-known-good VALUES, but every record must report the
      // real degraded health — build a fresh map so neither the retained
      // last-good state nor any previously-returned snapshot is mutated.
      const degraded = degradeHealth(lastGoodMap);
      const snap = toSnapshot<K>(degraded, lastGoodLoadedAtMs, 'store-unavailable');
      if (isNewest) {
        currentSnapshot = snap;
      }
      return snap;
    }

    const evaluated = evaluateFlags(registry, null, env, evalOptions);
    const snap = toSnapshot<K>(evaluated, Date.now(), 'store-unavailable');
    if (isNewest) {
      currentSnapshot = snap;
    }
    return snap;
  }

  async function ensureSnapshot(): Promise<FlagSnapshot<K>> {
    return currentSnapshot ?? doRefresh();
  }

  return {
    isEnabled: async (key) => (await ensureSnapshot()).isEnabled(key),
    get: async (key) => (await ensureSnapshot()).get(key),
    all: async () => (await ensureSnapshot()).all(),
    set: (key, enabled) => store.set(key, enabled),
    seed: () => store.seedMissing(seedFlags(registry)),
    loadSnapshot: doRefresh,
    refresh: async () => {
      await doRefresh();
    },
    snapshot: () => currentSnapshot,
    get loadedAt(): Date | null {
      return currentSnapshot?.loadedAt ?? null;
    },
  };
}
