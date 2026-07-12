import type { FlagDefinition } from './types';

/** The literal key union of a registry built by `defineFlags`. */
export type FlagKeys<T extends readonly FlagDefinition[]> = T[number]['key'];

/**
 * Declare a flag registry, preserving the literal key union so
 * `flags.isEnabled('typo')` is a TYPE ERROR rather than a silent runtime
 * fallback to the default. Throws at definition time on a duplicate key.
 */
export function defineFlags<const T extends readonly FlagDefinition[]>(defs: T): T {
  const seen = new Set<string>();
  for (const def of defs) {
    if (seen.has(def.key)) {
      throw new Error(`defineFlags: duplicate flag key "${def.key}"`);
    }
    seen.add(def.key);
  }
  return defs;
}
