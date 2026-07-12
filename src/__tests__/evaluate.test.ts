import { describe, it, expect } from 'vitest';
import { evaluateFlags, defaultEnvKey, defaultParseBool } from '../evaluate';
import type { FlagDefinition, StoredFlag } from '../types';

const registry: FlagDefinition[] = [
  { key: 'allow_signups', description: 'signups', default: true },
  { key: 'new_checkout', description: 'checkout', default: false },
];

describe('evaluateFlags precedence', () => {
  it('store beats environment beats default', () => {
    const stored: StoredFlag[] = [{ key: 'allow_signups', enabled: false }];
    const env = { FEATURE_ALLOW_SIGNUPS: 'true' };
    const result = evaluateFlags(registry, stored, env);
    expect(result.get('allow_signups')).toEqual({
      key: 'allow_signups',
      enabled: false,
      source: 'store',
      health: 'ok',
    });
  });

  it('environment beats default when there is no stored row', () => {
    const env = { FEATURE_NEW_CHECKOUT: 'true' };
    const result = evaluateFlags(registry, [], env);
    expect(result.get('new_checkout')).toEqual({
      key: 'new_checkout',
      enabled: true,
      source: 'environment',
      health: 'ok',
    });
  });

  it('registry default wins when neither store nor environment supply a value', () => {
    const result = evaluateFlags(registry, [], {});
    expect(result.get('allow_signups')).toEqual({
      key: 'allow_signups',
      enabled: true,
      source: 'default',
      health: 'ok',
    });
  });
});

describe('defaultParseBool', () => {
  it.each([
    ['1', true],
    ['true', true],
    ['yes', true],
    ['on', true],
    ['TRUE ', true],
    ['0', false],
    ['false', false],
    ['no', false],
    ['off', false],
  ])('%s -> %s', (raw, expected) => {
    expect(defaultParseBool(raw)).toBe(expected);
  });

  it('an unparseable value falls through as undefined, not false', () => {
    expect(defaultParseBool('banana')).toBeUndefined();
    expect(defaultParseBool('')).toBeUndefined();
  });

  it('falling through to undefined means the registry default is used, not false', () => {
    const env = { FEATURE_ALLOW_SIGNUPS: 'banana' };
    const result = evaluateFlags(registry, [], env);
    expect(result.get('allow_signups')?.enabled).toBe(true); // registry default, not false
    expect(result.get('allow_signups')?.source).toBe('default');
  });
});

describe('defaultEnvKey', () => {
  it.each([
    ['new.checkout', 'FEATURE_NEW_CHECKOUT'],
    ['new-checkout', 'FEATURE_NEW_CHECKOUT'],
    ['newCheckout', 'FEATURE_NEW_CHECKOUT'],
  ])('%s -> %s', (key, expected) => {
    expect(defaultEnvKey(key)).toBe(expected);
  });

  it('a custom envKey override is honored', () => {
    const reg: FlagDefinition[] = [{ key: 'new_checkout', description: 'x', default: false }];
    const env = { CUSTOM_NEW_CHECKOUT: 'true' };
    const result = evaluateFlags(reg, [], env, { envKey: (key) => `CUSTOM_${key.toUpperCase()}` });
    expect(result.get('new_checkout')).toMatchObject({ enabled: true, source: 'environment' });
  });

  it('a custom parseBool override is honored', () => {
    const reg: FlagDefinition[] = [{ key: 'new_checkout', description: 'x', default: false }];
    const env = { FEATURE_NEW_CHECKOUT: 'enable' };
    const result = evaluateFlags(reg, [], env, { parseBool: (raw) => (raw === 'enable' ? true : undefined) });
    expect(result.get('new_checkout')).toMatchObject({ enabled: true, source: 'environment' });
  });
});

describe('store-unavailable (stored === null)', () => {
  it('degrades health for every flag', () => {
    const result = evaluateFlags(registry, null, {});
    for (const flag of result.values()) {
      expect(flag.health).toBe('store-unavailable');
    }
  });

  it("onStoreError: 'disabled' resolves false even though the registry default is true (kill-switch), source reports the forced policy", () => {
    const reg: FlagDefinition[] = [
      { key: 'allow_signups', description: 'x', default: true, onStoreError: 'disabled' },
    ];
    const result = evaluateFlags(reg, null, {});
    expect(result.get('allow_signups')).toEqual({
      key: 'allow_signups',
      enabled: false,
      source: 'store-error-policy',
      health: 'store-unavailable',
    });
  });

  it("onStoreError: 'enabled' resolves true regardless of registry default, source reports the forced policy", () => {
    const reg: FlagDefinition[] = [
      { key: 'new_checkout', description: 'x', default: false, onStoreError: 'enabled' },
    ];
    const result = evaluateFlags(reg, null, {});
    expect(result.get('new_checkout')).toEqual({
      key: 'new_checkout',
      enabled: true,
      source: 'store-error-policy',
      health: 'store-unavailable',
    });
  });

  it("onStoreError: 'default' (or unset) falls through to environment", () => {
    const env = { FEATURE_NEW_CHECKOUT: 'true' };
    const result = evaluateFlags(registry, null, env);
    expect(result.get('new_checkout')).toEqual({
      key: 'new_checkout',
      enabled: true,
      source: 'environment',
      health: 'store-unavailable',
    });
  });

  it("onStoreError: 'default' falls through to the registry default when env is also absent", () => {
    const result = evaluateFlags(registry, null, {});
    expect(result.get('new_checkout')).toEqual({
      key: 'new_checkout',
      enabled: false,
      source: 'default',
      health: 'store-unavailable',
    });
  });
});

describe('purity', () => {
  it('never throws and performs no I/O beyond reading the passed-in env object', () => {
    expect(() => evaluateFlags(registry, null, {})).not.toThrow();
    expect(() => evaluateFlags(registry, [], {})).not.toThrow();
  });
});
