import type { AsyncFlagStore, StoredFlag } from '../types';

/**
 * Structural driver contract for a single-JSON-blob store (e.g. bewks's
 * `Setting` row keyed `'feature_flags'`). We never import Prisma — inject a
 * driver built on top of it (or anything else).
 */
export interface BlobDriver {
  /** The JSON blob, or `null` if the row doesn't exist yet. */
  read(): Promise<string | null>;
  /**
   * MUST be atomic (a transaction, or a conditional/compare-and-swap
   * update) — callers pass e.g. a Prisma `$transaction`. A non-atomic
   * `write` reintroduces the read-modify-write lost-update race this
   * indirection exists to prevent.
   */
  write(mutate: (current: Record<string, boolean>) => Record<string, boolean>): Promise<void>;
}

/**
 * Absence (`raw === null`, the row doesn't exist yet) is a healthy empty
 * store — every flag falls through to environment/default, `health` stays
 * `'ok'`. Corruption is NOT the same as absence: invalid JSON, a non-object
 * root, or a non-boolean value for a key all THROW, so the front ends treat
 * it as a store outage (`onStoreError` fires, `onStoreError` policy /
 * degraded health applies). Without this distinction a corrupted blob would
 * silently look like "no flags configured" and defeat any kill-switch.
 */
function parseBlob(raw: string | null): Record<string, boolean> {
  if (raw === null) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Feature-flag blob is malformed: invalid JSON (${(err as Error).message})`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    const kind = parsed === null ? 'null' : Array.isArray(parsed) ? 'array' : typeof parsed;
    throw new Error(`Feature-flag blob is malformed: expected a JSON object at the root, got ${kind}`);
  }
  const result: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== 'boolean') {
      throw new Error(`Feature-flag blob is malformed: value for "${key}" is not a boolean (got ${typeof value})`);
    }
    result[key] = value;
  }
  return result;
}

/**
 * An `AsyncFlagStore` over a single-JSON-blob row. `set` and `seedMissing`
 * both go through `write(mutate)` so the read-modify-write happens inside
 * the host's transaction — never a separate read then a separate write.
 * `load` treats an absent row as a healthy empty store (`[]`), but THROWS on
 * a malformed blob — see `parseBlob`. The front ends already treat a
 * throwing `load()` as a store outage, so this is what fires
 * `onStoreError`/degrades health/engages the kill-switch on corruption.
 */
export function createBlobFlagStore(driver: BlobDriver): AsyncFlagStore {
  return {
    async load(): Promise<StoredFlag[]> {
      const blob = parseBlob(await driver.read());
      return Object.entries(blob).map(([key, enabled]) => ({ key, enabled }));
    },
    async set(key: string, enabled: boolean): Promise<void> {
      await driver.write((current) => ({ ...current, [key]: enabled }));
    },
    async seedMissing(flags: readonly StoredFlag[]): Promise<void> {
      await driver.write((current) => {
        const next = { ...current };
        for (const flag of flags) {
          if (!(flag.key in next)) next[flag.key] = flag.enabled;
        }
        return next;
      });
    },
  };
}
