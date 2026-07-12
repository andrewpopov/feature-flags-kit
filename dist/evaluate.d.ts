import type { EvaluatedFlag, FlagDefinition, StoredFlag } from './types';
/** `key` -> `FEATURE_` + UPPER_SNAKE. Handles `dot.case`, `kebab-case`, and `camelCase` input. */
export declare function defaultEnvKey(key: string): string;
/** `'1'|'true'|'yes'|'on'` -> true; `'0'|'false'|'no'|'off'` -> false (case-insensitive, trimmed); else `undefined`. */
export declare function defaultParseBool(raw: string): boolean | undefined;
export interface EvaluateOptions {
    envKey?: (key: string) => string;
    parseBool?: (raw: string) => boolean | undefined;
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
export declare function evaluateFlags(registry: readonly FlagDefinition[], stored: StoredFlag[] | null, env: Record<string, string | undefined>, options?: EvaluateOptions): Map<string, EvaluatedFlag>;
