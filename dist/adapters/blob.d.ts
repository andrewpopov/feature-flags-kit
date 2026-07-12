import type { AsyncFlagStore } from '../types';
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
 * An `AsyncFlagStore` over a single-JSON-blob row. `set` and `seedMissing`
 * both go through `write(mutate)` so the read-modify-write happens inside
 * the host's transaction — never a separate read then a separate write.
 * `load` treats an absent row as a healthy empty store (`[]`), but THROWS on
 * a malformed blob — see `parseBlob`. The front ends already treat a
 * throwing `load()` as a store outage, so this is what fires
 * `onStoreError`/degrades health/engages the kill-switch on corruption.
 */
export declare function createBlobFlagStore(driver: BlobDriver): AsyncFlagStore;
