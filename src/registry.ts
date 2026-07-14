import type { FlagDefinition } from './types';
import { defaultEnvKey } from './evaluate';

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
export function defineFlags<const T extends readonly FlagDefinition[]>(defs: T, options: DefineFlagsOptions = {}): T {
  const seen = new Set<string>();
  const envKeys = new Map<string, string>();
  const envKey = options.envKey ?? defaultEnvKey;
  const aliases = new Set(options.allowEnvKeyAliases ?? []);
  for (const def of defs) {
    if (seen.has(def.key)) {
      throw new Error(`defineFlags: duplicate flag key "${def.key}"`);
    }
    seen.add(def.key);
    const normalizedEnvKey = envKey(def.key);
    const existingKey = envKeys.get(normalizedEnvKey);
    if (existingKey && !aliases.has(normalizedEnvKey)) {
      throw new Error(
        `defineFlags: keys "${existingKey}" and "${def.key}" both map to environment variable "${normalizedEnvKey}"`,
      );
    }
    envKeys.set(normalizedEnvKey, def.key);
  }
  return defs;
}
