# @andrewpopov/feature-flags-kit

Framework- and DB-agnostic **feature flags**: a pure evaluator with a fixed
precedence, a typed registry where an unknown key is a compile error, and
two thin front ends — sync (live per-call reads, no cache) and async (an
app-driven cached snapshot with last-known-good degradation).

## The precedence chain

Every flag resolves, in order: **store -> environment -> registry default.**

- If the store has a row for the key, that value wins (`source: 'store'`).
- Else, if the flag's env var (`FEATURE_<UPPER_SNAKE_KEY>` by default, e.g.
  `new.checkout` / `new-checkout` / `newCheckout` -> `FEATURE_NEW_CHECKOUT`)
  parses to a boolean, that wins (`source: 'environment'`).
- Else, the registry `default` wins (`source: 'default'`).

Both the env-key mapping and the boolean parser (`'1'|'true'|'yes'|'on'` /
`'0'|'false'|'no'|'off'`, case-insensitive) are overridable via `envKey` /
`parseBool` options.

`defineFlags` rejects registry keys that normalize to the same environment
variable (for example `new.checkout`, `new-checkout`, and `newCheckout` all
become `FEATURE_NEW_CHECKOUT`). This prevents one deployment setting from
silently controlling multiple flags. A shared variable is permitted only by
explicitly listing it in `allowEnvKeyAliases`.

## The kill-switch: `onStoreError`

If the store's `load()` **throws** (not merely "row missing" — a genuine
failure), every flag's `health` degrades to `'store-unavailable'` and the
resolved value is governed by that flag's `onStoreError` policy:

- `'enabled'` — always resolve `true` regardless of env/default.
  `source: 'store-error-policy'` — the forced policy won, not env/default.
- `'disabled'` — always resolve `false`, even if the registry default is
  `true`. This is the kill-switch case: a flag you want to fail CLOSED when
  its backing store is unreachable, no matter what it defaults to normally.
  `source: 'store-error-policy'` here too.
- `'default'` (or unset) — fall through to environment, then the registry
  default, same as a merely-missing row. `source` is `'environment'` or
  `'default'` accordingly, since env/registry genuinely won in that branch.

A store throwing never propagates out of `isEnabled`/`get`/`all` — you
always get a value back, plus an `onStoreError` callback for observability
so the fallback is never silent.

`FlagSource` is `'store' | 'environment' | 'default' | 'store-error-policy'`.
The last value exists specifically so a caller can tell "the forced
`onStoreError` policy resolved this" apart from "the registry default
genuinely won" — those are different facts even when they resolve to the
same boolean.

## Snapshot vs. live read

- **`SyncFlags`** (`createSyncFlags`) reads the store on every call — no
  cache — matching sano-os's synchronous better-sqlite3 model.
- **`AsyncFlags`** (`createAsyncFlags`) caches the last loaded result;
  `isEnabled`/`get`/`all` lazily load once and then serve from that cache
  until you call `refresh()`/`loadSnapshot()` explicitly. There is **no**
  implicit/hidden TTL — refresh is entirely app-driven.
- **`snapshot()`** (both front ends) returns an immutable, point-in-time
  `FlagSnapshot` — mutating the store afterward has no effect on values
  already read out of it.
- **Last-known-good**: if an `AsyncFlags` reload fails after a previous
  reload succeeded, the OLD values keep being served, but the snapshot's
  `health` — and every individual flag record's `health` from `get()`/
  `all()` — reports `'store-unavailable'` so callers can detect degradation
  without losing service. A snapshot's per-flag records never silently say
  `'ok'` while the snapshot itself is degraded.
- Snapshots are **immutable**: `get()`/`all()` always return frozen clones,
  never the internal records, so a caller mutating a returned flag (or
  `loadedAt`) can neither corrupt that snapshot nor poison a later
  last-known-good read.
- Overlapping `refresh()`/`loadSnapshot()` calls can never roll the cache
  backwards — each carries a monotonically increasing request id, and only
  the most-recently-issued call still outstanding when it resolves is
  allowed to commit into the cached snapshot/last-known-good state.

## Seeding

`seed()` always calls `store.seedMissing(registry defaults)` — **never**
`load()` + `set()`, which would race a concurrent write (read stale state,
then blindly overwrite it). `seedMissing` is documented to be atomic and
must never clobber an existing value.

## Install

```
npm install github:andrewpopov/feature-flags-kit#v0.1.2
```

## Use: sano-os-style, sync + SQL

```ts
import { defineFlags, createSyncFlags, createSqlFlagStore, FEATURE_FLAGS_SCHEMA_SQL } from '@andrewpopov/feature-flags-kit';
import Database from 'better-sqlite3';

// Apps own their migration explicitly — run this (or your own DDL) yourself.
const db = new Database('app.db');
db.exec(FEATURE_FLAGS_SCHEMA_SQL);

const registry = defineFlags([
  { key: 'allow_signups', description: 'Allow new users to register', default: true },
  { key: 'new_checkout', description: 'New checkout flow', default: false, onStoreError: 'disabled' },
]);

const store = createSqlFlagStore({
  all: (sql, params) => db.prepare(sql).all(...(params ?? [])),
  run: (sql, params) => db.prepare(sql).run(...(params ?? [])),
});

const flags = createSyncFlags(registry, store);
flags.seed(); // idempotent; on boot, once

if (flags.isEnabled('allow_signups')) {
  // ... allow the signup
}
```

## Use: bewks-style, async + JSON blob

```ts
import { defineFlags, createAsyncFlags, createBlobFlagStore } from '@andrewpopov/feature-flags-kit';
import { prisma } from './db/prisma';

const registry = defineFlags([
  { key: 'cloud_storage_v2', description: 'Cloud storage v2 backend', default: false },
]);

const store = createBlobFlagStore({
  read: async () => (await prisma.setting.findUnique({ where: { id: 'feature_flags' } }))?.data ?? null,
  write: async (mutate) =>
    prisma.$transaction(async (tx) => {
      const row = await tx.setting.findUnique({ where: { id: 'feature_flags' } });
      const current = row ? JSON.parse(row.data) : {};
      const next = mutate(current);
      await tx.setting.upsert({
        where: { id: 'feature_flags' },
        update: { data: JSON.stringify(next) },
        create: { id: 'feature_flags', data: JSON.stringify(next) },
      });
    }),
});

const flags = createAsyncFlags(registry, store);
await flags.seed();

const snapshot = await flags.loadSnapshot();
if (snapshot.isEnabled('cloud_storage_v2')) {
  // ...
}
```

## API

| Export | Purpose |
|---|---|
| `defineFlags(defs, options?)` | Build a typed registry; rejects duplicate keys and normalized environment-key collisions unless explicitly aliased. |
| `evaluateFlags(registry, stored, env, options?)` | Pure store -> environment -> default evaluator. No I/O, never throws. |
| `createSyncFlags(registry, store, options?)` | Live per-call `SyncFlags` front end. |
| `createAsyncFlags(registry, store, options?)` | Cached `AsyncFlags` front end with last-known-good. |
| `createSqlFlagStore(driver, options?)` | `SyncFlagStore` over a structurally-typed sync SQL driver. |
| `createBlobFlagStore(driver)` | `AsyncFlagStore` over a structurally-typed read/write(mutate) blob driver. `load()` treats an absent row as a healthy empty store (`[]`) but THROWS on a malformed blob (invalid JSON, a non-object root, or a non-boolean value) — corruption is an outage, not "no flags configured", so it engages `onStoreError`/the kill-switch instead of silently reverting to registry defaults. |
| `FEATURE_FLAGS_SCHEMA_SQL` | `CREATE TABLE IF NOT EXISTS` DDL for the `sql` adapter's default schema — apps own their migration explicitly; this store never auto-creates the table. |

`FlagDefinition`: `{ key, description, default, onStoreError? }`.
`EvaluatedFlag`: `{ key, enabled, source, health }`.
`FlagSnapshot`: `{ isEnabled, get, all, loadedAt, health }`.

### The store seam

`SyncFlagStore` (`load`/`set`/`seedMissing`, all synchronous) and
`AsyncFlagStore` (same three, all `Promise`-returning) are the two contracts
a consumer implements. Neither adapter imports its backing driver package —
`sql` takes a structurally-typed `SqlDriver`, `blob` takes a structurally-
typed `BlobDriver` — so this package has zero runtime dependencies and never
imports `@prisma/client` or `better-sqlite3`.

## Verify locally

```bash
npm ci
npm run verify
npm audit --omit=dev --audit-level=high
```

## Standards

See [`STANDARDS.md`](./STANDARDS.md) (synced from `agent_brain/knowledge/shared-package-standards.md`).

## Project policies

See [Contributing](./CONTRIBUTING.md), [Support](./SUPPORT.md), and the
[Security Policy](./SECURITY.md). This package is licensed under [MIT](./LICENSE).
