import { describe, it, expect } from 'vitest';
import { defineFlags } from '../registry';
import { createSyncFlags } from '../flags';
import type { StoredFlag, SyncFlagStore } from '../types';

describe('defineFlags', () => {
  it('returns the registry unchanged when keys are unique', () => {
    const defs = defineFlags([
      { key: 'a', description: 'a', default: true },
      { key: 'b', description: 'b', default: false },
    ] as const);
    expect(defs).toHaveLength(2);
  });

  it('throws on a duplicate key', () => {
    expect(() =>
      defineFlags([
        { key: 'a', description: 'a', default: true },
        { key: 'a', description: 'a again', default: false },
      ] as const),
    ).toThrow(/duplicate/i);
  });

  it('rejects keys that would silently share one normalized environment override', () => {
    expect(() =>
      defineFlags([
        { key: 'new.checkout', description: 'dot', default: false },
        { key: 'new-checkout', description: 'dash', default: false },
      ] as const),
    ).toThrow(/FEATURE_NEW_CHECKOUT/);
  });

  it('permits a collision only when the shared environment variable is explicitly declared as an alias', () => {
    expect(() =>
      defineFlags(
        [
          { key: 'new.checkout', description: 'dot', default: false },
          { key: 'newCheckout', description: 'camel', default: false },
        ] as const,
        { allowEnvKeyAliases: ['FEATURE_NEW_CHECKOUT'] },
      ),
    ).not.toThrow();
  });
});

describe('type-level: unknown key is a compile error', () => {
  it('smoke test to keep the file executable', () => {
    const registry = defineFlags([{ key: 'known_flag', description: 'x', default: true }] as const);
    const flags: StoredFlag[] = [];
    const store: SyncFlagStore = {
      load: () => flags,
      set: () => {},
      seedMissing: () => {},
    };
    const client = createSyncFlags(registry, store);
    expect(client.isEnabled('known_flag')).toBe(true);
    // Never actually invoked — this only needs to fail typecheck, not throw at runtime.
    const callWithUnknownKey = () =>
      // @ts-expect-error -- 'unknown_flag' is not part of the registry's key union.
      client.isEnabled('unknown_flag');
    expect(typeof callWithUnknownKey).toBe('function');
  });
});
