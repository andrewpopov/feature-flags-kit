import { describe, it, expect, vi } from 'vitest';
import { createSyncFlags, createAsyncFlags } from '../flags';
import { defineFlags } from '../registry';
import type { AsyncFlagStore, StoredFlag, SyncFlagStore } from '../types';

const registry = defineFlags([
  { key: 'allow_signups', description: 'x', default: true },
  { key: 'new_checkout', description: 'y', default: false, onStoreError: 'disabled' },
] as const);

function fakeSyncStore(initial: StoredFlag[] = []): SyncFlagStore & { rows: StoredFlag[] } {
  const rows = [...initial];
  return {
    rows,
    load: () => [...rows],
    set: (key, enabled) => {
      const existing = rows.find((r) => r.key === key);
      if (existing) existing.enabled = enabled;
      else rows.push({ key, enabled });
    },
    seedMissing: (flags) => {
      for (const f of flags) {
        if (!rows.some((r) => r.key === f.key)) rows.push({ ...f });
      }
    },
  };
}

function fakeAsyncStore(initial: StoredFlag[] = []): AsyncFlagStore & { rows: StoredFlag[]; shouldThrow: boolean } {
  const state = {
    rows: [...initial],
    shouldThrow: false,
    async load() {
      if (state.shouldThrow) throw new Error('store unavailable');
      return [...state.rows];
    },
    async set(key: string, enabled: boolean) {
      const existing = state.rows.find((r) => r.key === key);
      if (existing) existing.enabled = enabled;
      else state.rows.push({ key, enabled });
    },
    async seedMissing(flags: readonly StoredFlag[]) {
      for (const f of flags) {
        if (!state.rows.some((r) => r.key === f.key)) state.rows.push({ ...f });
      }
    },
  };
  return state;
}

describe('createSyncFlags', () => {
  it('isEnabled returns a plain boolean, not a Promise', () => {
    const store = fakeSyncStore();
    const flags = createSyncFlags(registry, store);
    const value = flags.isEnabled('allow_signups');
    expect(typeof value).toBe('boolean');
  });

  it('reads the store live on every call', () => {
    const store = fakeSyncStore([{ key: 'allow_signups', enabled: true }]);
    const flags = createSyncFlags(registry, store);
    expect(flags.isEnabled('allow_signups')).toBe(true);
    store.rows[0].enabled = false;
    expect(flags.isEnabled('allow_signups')).toBe(false);
  });

  it('a store throw does not propagate, and onStoreError fires', () => {
    const store: SyncFlagStore = {
      load: () => {
        throw new Error('boom');
      },
      set: vi.fn(),
      seedMissing: vi.fn(),
    };
    const onStoreError = vi.fn();
    const flags = createSyncFlags(registry, store, { onStoreError });
    expect(() => flags.isEnabled('allow_signups')).not.toThrow();
    expect(onStoreError).toHaveBeenCalledWith(expect.any(Error));
  });

  it("kill-switch: onStoreError 'disabled' resolves false on a store throw even though the registry default is true", () => {
    const killSwitchRegistry = defineFlags([
      { key: 'risky_feature', description: 'x', default: true, onStoreError: 'disabled' },
    ] as const);
    const store: SyncFlagStore = {
      load: () => {
        throw new Error('boom');
      },
      set: vi.fn(),
      seedMissing: vi.fn(),
    };
    const flags = createSyncFlags(killSwitchRegistry, store);
    expect(flags.get('risky_feature')).toMatchObject({ enabled: false, health: 'store-unavailable' });
  });

  it('seed() calls store.seedMissing with registry defaults, and never calls set/load', () => {
    const load = vi.fn(() => []);
    const set = vi.fn();
    const seedMissing = vi.fn();
    const store: SyncFlagStore = { load, set, seedMissing };
    const flags = createSyncFlags(registry, store);
    flags.seed();
    expect(seedMissing).toHaveBeenCalledWith([
      { key: 'allow_signups', enabled: true },
      { key: 'new_checkout', enabled: false },
    ]);
    expect(set).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  it('seeding never clobbers an existing false value even when the registry default is true', () => {
    const store = fakeSyncStore([{ key: 'allow_signups', enabled: false }]);
    const flags = createSyncFlags(registry, store);
    flags.seed();
    expect(flags.isEnabled('allow_signups')).toBe(false);
  });

  it('set() errors propagate', () => {
    const store: SyncFlagStore = {
      load: () => [],
      set: () => {
        throw new Error('write failed');
      },
      seedMissing: () => {},
    };
    const flags = createSyncFlags(registry, store);
    expect(() => flags.set('allow_signups', false)).toThrow('write failed');
  });

  it('seed() errors propagate', () => {
    const store: SyncFlagStore = {
      load: () => [],
      set: () => {},
      seedMissing: () => {
        throw new Error('seed failed');
      },
    };
    const flags = createSyncFlags(registry, store);
    expect(() => flags.seed()).toThrow('seed failed');
  });

  it('snapshot() is a point-in-time read: mutating the store afterward does not change it', () => {
    const store = fakeSyncStore([{ key: 'allow_signups', enabled: true }]);
    const flags = createSyncFlags(registry, store);
    const snap = flags.snapshot();
    expect(snap.isEnabled('allow_signups')).toBe(true);
    store.rows[0].enabled = false;
    expect(snap.isEnabled('allow_signups')).toBe(true);
    expect(flags.isEnabled('allow_signups')).toBe(false); // live read sees the change
  });

  it('forced onStoreError policy reports source "store-error-policy", not "default"', () => {
    const store: SyncFlagStore = {
      load: () => {
        throw new Error('boom');
      },
      set: vi.fn(),
      seedMissing: vi.fn(),
    };
    const flags = createSyncFlags(registry, store);
    // new_checkout has onStoreError: 'disabled'.
    expect(flags.get('new_checkout')).toMatchObject({
      enabled: false,
      source: 'store-error-policy',
      health: 'store-unavailable',
    });
  });

  it('snapshot() returns frozen records: mutating a get()/all() result does not affect the snapshot', () => {
    const store = fakeSyncStore([{ key: 'allow_signups', enabled: true }]);
    const flags = createSyncFlags(registry, store);
    const snap = flags.snapshot();
    const record = snap.get('allow_signups');
    expect(Object.isFrozen(record)).toBe(true);
    expect(() => {
      (record as { enabled: boolean }).enabled = false;
    }).toThrow();
    expect(snap.get('allow_signups').enabled).toBe(true);

    const all = snap.all();
    expect(Object.isFrozen(all[0])).toBe(true);
  });
});

describe('createAsyncFlags', () => {
  it('last-known-good: a successful refresh followed by a throwing store still serves the OLD values, with degraded health', async () => {
    const store = fakeAsyncStore([{ key: 'allow_signups', enabled: true }]);
    const flags = createAsyncFlags(registry, store);
    const first = await flags.loadSnapshot();
    expect(first.isEnabled('allow_signups')).toBe(true);
    expect(first.health).toBe('ok');

    store.shouldThrow = true;
    store.rows[0].enabled = false; // would-be new value, never actually read
    const second = await flags.loadSnapshot();
    expect(second.isEnabled('allow_signups')).toBe(true); // still the OLD value
    expect(second.health).toBe('store-unavailable');
  });

  it('F4: every per-flag record on a degraded snapshot reports health store-unavailable, and the earlier snapshot object is untouched', async () => {
    const store = fakeAsyncStore([{ key: 'allow_signups', enabled: true }]);
    const flags = createAsyncFlags(registry, store);
    const first = await flags.loadSnapshot();
    expect(first.get('allow_signups').health).toBe('ok');

    store.shouldThrow = true;
    const second = await flags.loadSnapshot();

    // The retained VALUE is unchanged, but every per-flag record says degraded.
    expect(second.get('allow_signups')).toMatchObject({ enabled: true, health: 'store-unavailable' });
    for (const flag of second.all()) {
      expect(flag.health).toBe('store-unavailable');
    }

    // The snapshot object returned earlier must remain exactly as it was.
    expect(first.health).toBe('ok');
    expect(first.get('allow_signups').health).toBe('ok');
  });

  it('F3: mutating a record from get()/all() does not affect the snapshot, isEnabled(), or a later degraded snapshot', async () => {
    const store = fakeAsyncStore([{ key: 'allow_signups', enabled: true }]);
    const flags = createAsyncFlags(registry, store);
    const snap = await flags.loadSnapshot();

    const record = snap.get('allow_signups');
    expect(Object.isFrozen(record)).toBe(true);
    expect(() => {
      (record as { enabled: boolean }).enabled = false;
    }).toThrow();
    expect(snap.isEnabled('allow_signups')).toBe(true);

    const allRecord = snap.all().find((f) => f.key === 'allow_signups');
    expect(Object.isFrozen(allRecord)).toBe(true);

    // loadedAt is also not mutable in a way that affects the snapshot.
    const loadedAt = snap.loadedAt;
    loadedAt.setFullYear(1970);
    expect(snap.loadedAt.getFullYear()).not.toBe(1970);

    // A later degraded snapshot still reports the real (unpoisoned) value.
    store.shouldThrow = true;
    const degraded = await flags.loadSnapshot();
    expect(degraded.isEnabled('allow_signups')).toBe(true);
    expect(degraded.health).toBe('store-unavailable');
  });

  it('F5: overlapping refreshes commit in resolution order, not issue order — a stale late-resolving result is dropped', async () => {
    let resolveFirst!: (rows: StoredFlag[]) => void;
    let callCount = 0;
    const store: AsyncFlagStore = {
      load: () =>
        new Promise<StoredFlag[]>((resolve) => {
          callCount += 1;
          if (callCount === 1) {
            // First-issued call: hang until we explicitly resolve it, after the second.
            resolveFirst = resolve;
          } else {
            resolve([{ key: 'allow_signups', enabled: false }]);
          }
        }),
      set: async () => {},
      seedMissing: async () => {},
    };
    const flags = createAsyncFlags(registry, store);

    const firstRefresh = flags.loadSnapshot(); // id 1, issued first, resolves last
    const secondRefresh = await flags.loadSnapshot(); // id 2, issued second, resolves first
    expect(secondRefresh.isEnabled('allow_signups')).toBe(false);

    resolveFirst([{ key: 'allow_signups', enabled: true }]); // stale, older data
    await firstRefresh;

    // The committed snapshot must still hold the newer data — the stale
    // first-issued result must not have overwritten it.
    expect(flags.snapshot()?.isEnabled('allow_signups')).toBe(false);
  });

  it('seed() calls store.seedMissing with registry defaults, and never calls set/load', async () => {
    const load = vi.fn(async () => []);
    const set = vi.fn(async () => {});
    const seedMissing = vi.fn(async () => {});
    const store: AsyncFlagStore = { load, set, seedMissing };
    const flags = createAsyncFlags(registry, store);
    await flags.seed();
    expect(seedMissing).toHaveBeenCalledWith([
      { key: 'allow_signups', enabled: true },
      { key: 'new_checkout', enabled: false },
    ]);
    expect(set).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  it('seeding never clobbers an existing false value even when the registry default is true', async () => {
    const store = fakeAsyncStore([{ key: 'allow_signups', enabled: false }]);
    const flags = createAsyncFlags(registry, store);
    await flags.seed();
    expect(await flags.isEnabled('allow_signups')).toBe(false);
  });

  it('set()/seed() errors propagate', async () => {
    const store: AsyncFlagStore = {
      load: async () => [],
      set: async () => {
        throw new Error('write failed');
      },
      seedMissing: async () => {
        throw new Error('seed failed');
      },
    };
    const flags = createAsyncFlags(registry, store);
    await expect(flags.set('allow_signups', false)).rejects.toThrow('write failed');
    await expect(flags.seed()).rejects.toThrow('seed failed');
  });

  it('snapshot() returns null before any load, then the last loaded snapshot', async () => {
    const store = fakeAsyncStore([{ key: 'allow_signups', enabled: true }]);
    const flags = createAsyncFlags(registry, store);
    expect(flags.snapshot()).toBeNull();
    await flags.loadSnapshot();
    expect(flags.snapshot()).not.toBeNull();
    expect(flags.snapshot()?.isEnabled('allow_signups')).toBe(true);
  });

  it('isEnabled/get/all cache the loaded snapshot and only reload on refresh (no hidden TTL)', async () => {
    const store = fakeAsyncStore([{ key: 'allow_signups', enabled: true }]);
    const flags = createAsyncFlags(registry, store);
    expect(await flags.isEnabled('allow_signups')).toBe(true);
    store.rows[0].enabled = false;
    expect(await flags.isEnabled('allow_signups')).toBe(true); // still cached
    await flags.refresh();
    expect(await flags.isEnabled('allow_signups')).toBe(false); // picked up after explicit refresh
  });

  it('loadedAt is null before any load and set after loading', async () => {
    const store = fakeAsyncStore();
    const flags = createAsyncFlags(registry, store);
    expect(flags.loadedAt).toBeNull();
    await flags.loadSnapshot();
    expect(flags.loadedAt).toBeInstanceOf(Date);
  });

  it('falls back to onStoreError policy when the store has never loaded successfully and throws', async () => {
    const store: AsyncFlagStore = {
      load: async () => {
        throw new Error('boom');
      },
      set: async () => {},
      seedMissing: async () => {},
    };
    const onStoreError = vi.fn();
    const flags = createAsyncFlags(registry, store, { onStoreError });
    const snap = await flags.loadSnapshot();
    expect(snap.health).toBe('store-unavailable');
    expect(snap.isEnabled('new_checkout')).toBe(false); // onStoreError: 'disabled'
    expect(onStoreError).toHaveBeenCalledWith(expect.any(Error));
  });
});
