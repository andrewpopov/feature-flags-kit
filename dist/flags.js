"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSyncFlags = createSyncFlags;
exports.createAsyncFlags = createAsyncFlags;
const evaluate_1 = require("./evaluate");
function resolveEnv(env) {
    if (env)
        return env;
    return typeof process !== 'undefined' ? process.env : {};
}
function requireFlag(map, key) {
    const flag = map.get(key);
    if (!flag)
        throw new Error(`Unknown feature flag: "${key}"`);
    return flag;
}
/** Defensive clone so a caller mutating a returned record can never reach (or poison) internal state. */
function freezeFlag(flag) {
    return Object.freeze({ ...flag });
}
/**
 * Builds an immutable point-in-time `FlagSnapshot`. `get`/`all` always
 * return frozen clones — never the internal records — so a caller mutating
 * a returned object can neither corrupt a later snapshot nor poison
 * retained last-known-good state. `loadedAt` is stored as a number
 * internally and exposed via a getter that mints a fresh `Date` each read.
 */
function toSnapshot(map, loadedAtMs, health) {
    return {
        isEnabled: (key) => requireFlag(map, key).enabled,
        get: (key) => freezeFlag(requireFlag(map, key)),
        all: () => Array.from(map.values(), freezeFlag),
        get loadedAt() {
            return new Date(loadedAtMs);
        },
        health,
    };
}
function healthOf(map) {
    for (const flag of map.values()) {
        if (flag.health === 'store-unavailable')
            return 'store-unavailable';
    }
    return 'ok';
}
/**
 * Returns a NEW map with every record's `enabled`/`source` retained but
 * `health` forced to `'store-unavailable'`. Never mutates the input map —
 * the retained last-known-good state must stay exactly as it was when it
 * was last a successful read.
 */
function degradeHealth(map) {
    const next = new Map();
    for (const [key, flag] of map) {
        next.set(key, { ...flag, health: 'store-unavailable' });
    }
    return next;
}
function seedFlags(registry) {
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
function createSyncFlags(registry, store, options = {}) {
    const env = resolveEnv(options.env);
    const evalOptions = { envKey: options.envKey, parseBool: options.parseBool };
    function evaluate() {
        let stored;
        try {
            stored = store.load();
        }
        catch (err) {
            options.onStoreError?.(err);
            stored = null;
        }
        return (0, evaluate_1.evaluateFlags)(registry, stored, env, evalOptions);
    }
    return {
        isEnabled: (key) => requireFlag(evaluate(), key).enabled,
        get: (key) => freezeFlag(requireFlag(evaluate(), key)),
        all: () => Array.from(evaluate().values(), freezeFlag),
        set: (key, enabled) => store.set(key, enabled),
        seed: () => store.seedMissing(seedFlags(registry)),
        snapshot: () => {
            const map = evaluate();
            return toSnapshot(map, Date.now(), healthOf(map));
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
function createAsyncFlags(registry, store, options = {}) {
    const env = resolveEnv(options.env);
    const evalOptions = { envKey: options.envKey, parseBool: options.parseBool };
    let lastGoodMap = null;
    let lastGoodLoadedAtMs = null;
    let currentSnapshot = null;
    // Monotonic request id so overlapping refreshes can't commit out of order:
    // a slow-to-resolve older refresh must never overwrite a newer one that
    // already landed. Only the call whose id is still the newest issued at
    // the time it resolves is allowed to write `currentSnapshot`/`lastGoodMap`.
    let requestSeq = 0;
    async function doRefresh() {
        const requestId = ++requestSeq;
        let stored;
        try {
            stored = await store.load();
        }
        catch (err) {
            options.onStoreError?.(err);
            stored = null;
        }
        const isNewest = requestId === requestSeq;
        if (stored !== null) {
            const evaluated = (0, evaluate_1.evaluateFlags)(registry, stored, env, evalOptions);
            const loadedAtMs = Date.now();
            const snap = toSnapshot(evaluated, loadedAtMs, 'ok');
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
            const snap = toSnapshot(degraded, lastGoodLoadedAtMs, 'store-unavailable');
            if (isNewest) {
                currentSnapshot = snap;
            }
            return snap;
        }
        const evaluated = (0, evaluate_1.evaluateFlags)(registry, null, env, evalOptions);
        const snap = toSnapshot(evaluated, Date.now(), 'store-unavailable');
        if (isNewest) {
            currentSnapshot = snap;
        }
        return snap;
    }
    async function ensureSnapshot() {
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
        get loadedAt() {
            return currentSnapshot?.loadedAt ?? null;
        },
    };
}
