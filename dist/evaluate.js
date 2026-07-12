"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultEnvKey = defaultEnvKey;
exports.defaultParseBool = defaultParseBool;
exports.evaluateFlags = evaluateFlags;
const ENV_PREFIX = 'FEATURE_';
/** `key` -> `FEATURE_` + UPPER_SNAKE. Handles `dot.case`, `kebab-case`, and `camelCase` input. */
function defaultEnvKey(key) {
    const snake = key
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/[.\-\s]+/g, '_')
        .toUpperCase();
    return `${ENV_PREFIX}${snake}`;
}
const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);
/** `'1'|'true'|'yes'|'on'` -> true; `'0'|'false'|'no'|'off'` -> false (case-insensitive, trimmed); else `undefined`. */
function defaultParseBool(raw) {
    const normalized = raw.trim().toLowerCase();
    if (TRUE_VALUES.has(normalized))
        return true;
    if (FALSE_VALUES.has(normalized))
        return false;
    return undefined;
}
function envOverride(def, env, envKeyFn, parseBoolFn) {
    const raw = env[envKeyFn(def.key)];
    if (raw === undefined)
        return undefined;
    return parseBoolFn(raw);
}
function evaluateOne(def, storedMap, env, envKeyFn, parseBoolFn) {
    // Store reachable (possibly missing this key): store -> environment -> default.
    if (storedMap !== null) {
        if (storedMap.has(def.key)) {
            return { key: def.key, enabled: storedMap.get(def.key), source: 'store', health: 'ok' };
        }
        const fromEnv = envOverride(def, env, envKeyFn, parseBoolFn);
        if (fromEnv !== undefined) {
            return { key: def.key, enabled: fromEnv, source: 'environment', health: 'ok' };
        }
        return { key: def.key, enabled: def.default, source: 'default', health: 'ok' };
    }
    // Store THREW: health degrades for every flag; the kill-switch policy wins over env/default.
    const policy = def.onStoreError ?? 'default';
    if (policy === 'enabled') {
        return { key: def.key, enabled: true, source: 'store-error-policy', health: 'store-unavailable' };
    }
    if (policy === 'disabled') {
        return { key: def.key, enabled: false, source: 'store-error-policy', health: 'store-unavailable' };
    }
    const fromEnv = envOverride(def, env, envKeyFn, parseBoolFn);
    if (fromEnv !== undefined) {
        return { key: def.key, enabled: fromEnv, source: 'environment', health: 'store-unavailable' };
    }
    return { key: def.key, enabled: def.default, source: 'default', health: 'store-unavailable' };
}
/**
 * Pure evaluator — the heart of the package. Both `createSyncFlags` and
 * `createAsyncFlags` delegate every evaluation to this function; it performs
 * no I/O and never throws.
 *
 * Precedence per flag: store -> environment -> registry default. `stored ===
 * null` means the store's `load()` threw — see `FlagDefinition.onStoreError`
 * for how that degrades per flag.
 */
function evaluateFlags(registry, stored, env, options = {}) {
    const envKeyFn = options.envKey ?? defaultEnvKey;
    const parseBoolFn = options.parseBool ?? defaultParseBool;
    const storedMap = stored ? new Map(stored.map((s) => [s.key, s.enabled])) : null;
    const result = new Map();
    for (const def of registry) {
        result.set(def.key, evaluateOne(def, storedMap, env, envKeyFn, parseBoolFn));
    }
    return result;
}
