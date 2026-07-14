import type { FlagDefinition } from './types';
/** The literal key union of a registry built by `defineFlags`. */
export type FlagKeys<T extends readonly FlagDefinition[]> = T[number]['key'];
export interface DefineFlagsOptions {
    /** Maps a flag key to its environment override name. Defaults to `defaultEnvKey`. */
    envKey?: (key: string) => string;
    /**
     * Explicit environment variable names that intentionally control more than
     * one flag. Omit this in normal use: collisions otherwise throw at startup.
     */
    allowEnvKeyAliases?: readonly string[];
}
/**
 * Declare a flag registry, preserving the literal key union so
 * `flags.isEnabled('typo')` is a TYPE ERROR rather than a silent runtime
 * fallback to the default. Throws at definition time on a duplicate key.
 */
export declare function defineFlags<const T extends readonly FlagDefinition[]>(defs: T, options?: DefineFlagsOptions): T;
