import { describe, it, expect, vi } from 'vitest';
import { createBlobFlagStore } from '../../adapters/blob';
import type { BlobDriver } from '../../adapters/blob';
import { createAsyncFlags } from '../../flags';
import { defineFlags } from '../../registry';

function fakeDriver(initial: string | null): BlobDriver & { raw: string | null } {
  const state = { raw: initial };
  return {
    get raw() {
      return state.raw;
    },
    set raw(v: string | null) {
      state.raw = v;
    },
    read: async () => state.raw,
    write: vi.fn(async (mutate: (current: Record<string, boolean>) => Record<string, boolean>) => {
      const current = state.raw ? (JSON.parse(state.raw) as Record<string, boolean>) : {};
      state.raw = JSON.stringify(mutate(current));
    }),
  };
}

describe('createBlobFlagStore', () => {
  it('load parses the JSON blob into StoredFlag rows', async () => {
    const driver = fakeDriver(JSON.stringify({ a: true, b: false }));
    const store = createBlobFlagStore(driver);
    const rows = await store.load();
    expect(rows).toEqual(
      expect.arrayContaining([
        { key: 'a', enabled: true },
        { key: 'b', enabled: false },
      ]),
    );
  });

  it('malformed JSON rejects load() rather than silently yielding []', async () => {
    const driver = fakeDriver('{not json');
    const store = createBlobFlagStore(driver);
    await expect(store.load()).rejects.toThrow(/malformed/i);
  });

  it('a non-object root (array) rejects load()', async () => {
    const driver = fakeDriver(JSON.stringify(['a', 'b']));
    const store = createBlobFlagStore(driver);
    await expect(store.load()).rejects.toThrow(/malformed/i);
  });

  it('a non-object root (string) rejects load()', async () => {
    const driver = fakeDriver(JSON.stringify('oops'));
    const store = createBlobFlagStore(driver);
    await expect(store.load()).rejects.toThrow(/malformed/i);
  });

  it('a non-object root (number) rejects load()', async () => {
    const driver = fakeDriver(JSON.stringify(42));
    const store = createBlobFlagStore(driver);
    await expect(store.load()).rejects.toThrow(/malformed/i);
  });

  it('a non-boolean value for a key rejects load()', async () => {
    const driver = fakeDriver(JSON.stringify({ a: 'yes' }));
    const store = createBlobFlagStore(driver);
    await expect(store.load()).rejects.toThrow(/malformed/i);
  });

  it('a null (absent) blob yields [], not a throw — absence is healthy', async () => {
    const driver = fakeDriver(null);
    const store = createBlobFlagStore(driver);
    await expect(store.load()).resolves.toEqual([]);
  });

  it('end-to-end: a corrupt blob behind the kill-switch resolves false, fires onStoreError, and degrades health', async () => {
    const driver = fakeDriver('{not json');
    const store = createBlobFlagStore(driver);
    const registry = defineFlags([
      { key: 'risky_feature', description: 'x', default: true, onStoreError: 'disabled' },
    ] as const);
    const onStoreError = vi.fn();
    const flags = createAsyncFlags(registry, store, { onStoreError });
    const snapshot = await flags.loadSnapshot();
    expect(snapshot.isEnabled('risky_feature')).toBe(false);
    expect(snapshot.health).toBe('store-unavailable');
    expect(onStoreError).toHaveBeenCalledWith(expect.any(Error));
  });

  it('set goes through write(mutate), not a separate read-then-write', async () => {
    const driver = fakeDriver(JSON.stringify({ a: true }));
    const store = createBlobFlagStore(driver);
    await store.set('b', false);
    expect(driver.write).toHaveBeenCalledTimes(1);
    expect(driver.write).toHaveBeenCalledWith(expect.any(Function));
    expect(JSON.parse(driver.raw as string)).toEqual({ a: true, b: false });
  });

  it('seedMissing goes through write(mutate) and never clobbers an existing key', async () => {
    const driver = fakeDriver(JSON.stringify({ a: false }));
    const store = createBlobFlagStore(driver);
    await store.seedMissing([
      { key: 'a', enabled: true },
      { key: 'b', enabled: true },
    ]);
    expect(driver.write).toHaveBeenCalledTimes(1);
    expect(JSON.parse(driver.raw as string)).toEqual({ a: false, b: true });
  });
});
