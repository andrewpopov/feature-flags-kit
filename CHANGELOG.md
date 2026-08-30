# Changelog

## 0.1.4

- Release tooling upgraded to release-kit v0.3.1, so a feature release is graded as a minor rather than a patch
  This package's release-kit was pinned at v0.2.0, whose `stableSemver` incremented the patch component regardless of fragment kind — measured directly, a `minor` and even a `major` bump both resolved to a patch, and `bumpLevelSupport` was absent. Any release adding public surface would therefore have been published as a patch, telling every consumer the upgrade added nothing. That was not hypothetical: during the PKG-114 cuts, alert-kit on v0.2.0 derived 0.5.1 for a release that added a whole new public module, caught only because the derived version was read before cutting.
  
  No runtime change — release-kit is a devDependency and nothing this package exports is affected.
- the aggregate verification gate now rejects stale committed build output
  The package's main verification command now includes its committed-`dist/`
  freshness guard.
- Snapshots are now runtime-frozen, and a throwing sync store with an empty registry now reports store-unavailable
  A completeness audit (PKG-146) found two gaps between the README's claims and the runtime. First, `FlagSnapshot` objects returned by `snapshot()`/`loadSnapshot()` were plain mutable objects, not frozen — a consumer overwriting `health` or a method on an `AsyncFlags` snapshot mutated the SAME cached object every later `snapshot()` call returns, silently poisoning every subsequent reader. `toSnapshot()` now freezes the returned object itself in addition to the already-frozen `get()`/`all()` clones, so nothing reachable from a snapshot can be mutated. Second, `createSyncFlags().snapshot()` inferred `health` by scanning the evaluated map for a degraded per-flag record; with an empty registry, a throwing store produced an empty map that looked identical to a healthy empty registry, so `health` silently reported `'ok'` while the store was actually down. `health` is now tracked directly from whether `store.load()` succeeded, matching the `AsyncFlags` front end (which already tracked this correctly and was not affected). The README's immutability claim is also tightened to state precisely what is frozen.

## 0.1.3

- Manage releases with release-kit (fragment-based CHANGELOG + version bump)
  Releases are now driven by release-kit: describe each change as a fragment under `.changes/unreleased/` and run `npm run release:cut` to compile them into a new CHANGELOG section, bump the version, and archive the fragments.

## 0.1.2

- Add public contribution, support, and private vulnerability-reporting policies.
- Reject duplicate normalized environment variable names at registry creation.
  A collision is allowed only when the shared variable is explicitly listed in
  `allowEnvKeyAliases`.
- Add `npm run verify` for the local release gate.
- Upgrade the Vitest development toolchain to a version with no known advisories.

## 0.1.1

Fix — expose `./package.json` in the `exports` map. Without it,
`require('@andrewpopov/feature-flags-kit/package.json')` threw
`ERR_PACKAGE_PATH_NOT_EXPORTED` — which broke the standards' own documented way of
verifying an INSTALLED version, the guard against the `github:` re-resolve trap.

No runtime change.

## 0.1.0 — 2026-07-12

Initial release. Framework- and DB-agnostic feature flags, superset of
sano-os's synchronous better-sqlite3 flags service and bewks's async
single-JSON-blob Prisma flags.

- `evaluateFlags(registry, stored, env, options?)`: pure store ->
  environment -> registry-default evaluator. No I/O, never throws. Default
  env-key mapping `key -> FEATURE_<UPPER_SNAKE>` and default boolean parser
  (`'1'|'true'|'yes'|'on'` / `'0'|'false'|'no'|'off'`), both overridable via
  `envKey`/`parseBool`.
- `defineFlags(defs)`: typed registry preserving the literal key union, so an
  unknown key elsewhere is a compile error. Throws at definition time on a
  duplicate key.
- `FlagDefinition.onStoreError`: per-flag policy (`'default' | 'enabled' |
  'disabled'`) for what to resolve to when the store's `load()` throws
  (not merely "row missing"). `'disabled'` is the kill-switch case — it
  resolves `false` even when the registry default is `true`.
- `createSyncFlags(registry, store, options?)`: live per-call `SyncFlags`
  front end over a `SyncFlagStore` (e.g. better-sqlite3). `isEnabled`
  returns a plain `boolean`, not a `Promise` — matches sano-os.
- `createAsyncFlags(registry, store, options?)`: cached `AsyncFlags` front
  end over an `AsyncFlagStore` (e.g. a Prisma-backed JSON blob).
  `isEnabled`/`get`/`all` lazily load once and then serve from that cache —
  no implicit/hidden TTL, `refresh()`/`loadSnapshot()` is entirely
  app-driven. Last-known-good: a failed reload after a prior success keeps
  serving the OLD values but reports `health: 'store-unavailable'` on the
  snapshot.
- `FlagSnapshot`: an immutable, point-in-time read (`isEnabled`, `get`,
  `all`, `loadedAt`, `health`) returned by `snapshot()` (sync, both front
  ends) and `loadSnapshot()` (async).
- `seed()`/`seedMissing`: always atomic insert-only-missing — never
  `load()` + `set()`, which would race a concurrent write and clobber an
  existing toggle.
- `createSqlFlagStore(driver, options?)`: `SyncFlagStore` over a
  structurally-typed `SqlDriver` (never imports better-sqlite3).
  `seedMissing` issues `INSERT ... ON CONFLICT(key) DO NOTHING`; `load`
  coerces `0`/`1` to booleans. Exports `FEATURE_FLAGS_SCHEMA_SQL` — apps own
  their migration explicitly; this store never auto-creates the table.
- `createBlobFlagStore(driver)`: `AsyncFlagStore` over a structurally-typed
  `BlobDriver` (never imports `@prisma/client`). `set`/`seedMissing` both go
  through `write(mutate)` so the read-modify-write happens inside the host's
  transaction. `load` treats an absent blob as `[]` (a healthy empty
  store), but THROWS on a malformed blob — invalid JSON, a non-object root,
  or a non-boolean value for a key. Corruption is not the same as absence:
  a throw is what makes `onStoreError`/the per-flag kill-switch engage,
  instead of a corrupted blob silently looking like "no flags configured".
- `FlagSource` includes `'store-error-policy'`: when the store's `load()`
  throws and a flag's `onStoreError` is `'enabled'`/`'disabled'`, the
  resolved `source` is `'store-error-policy'`, not `'default'` — the
  forced policy won, which is a different fact from the registry default
  genuinely winning even when the two happen to resolve to the same value.
  The `'default'` (fall-through) policy still reports `'environment'` or
  `'default'` as appropriate.
- `FlagSnapshot`/`AsyncFlags`/`SyncFlags` `get()`/`all()` return frozen
  clones of each `EvaluatedFlag`, never the internal record — a caller
  mutating a returned flag (or `loadedAt`) can no longer corrupt that
  snapshot or poison the retained last-known-good state.
- `AsyncFlags` last-known-good: when a refresh fails after a previous
  success, every per-flag record from `get()`/`all()` on the resulting
  snapshot now reports `health: 'store-unavailable'` (previously only the
  snapshot's own `.health` degraded, while individual records still said
  `'ok'`, a contradiction). The retained values are unchanged, and the
  previously-returned snapshot object is never mutated.
- `AsyncFlags` `refresh()`/`loadSnapshot()`: overlapping calls now carry a
  monotonically increasing request id and only the most-recently-issued
  call still outstanding when it resolves commits into the cached
  snapshot/last-known-good state — a slower, earlier-issued refresh
  resolving after a newer one can no longer roll the cache backwards.
