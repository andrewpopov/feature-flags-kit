# Shared Package Standards

> **Canonical source:** `agent_brain/knowledge/shared-package-standards.md`.
> This file is a synced copy; change the canonical doc first.

This is a **TypeScript package**: source in `src/`, compiled with `tsc` to a
**committed** `dist/`. `main`/`types` point at `dist/`; the type gate is
`typecheck` + `build` + a dist-freshness check in CI. Zero runtime dependencies.

Distribution, versioning, branch protection, CI, and the release checklist follow
the canonical standard. Engineering standards that apply here:

1. **Superset of every consumer's copy.** This package must be at least as
   capable as sano-os's synchronous better-sqlite3 flags service and bewks's
   single-JSON-blob Prisma flags before either is migrated onto it — typed
   registry, idempotent non-clobbering seeding, and a documented fallback
   for a down/missing store are table stakes, not extras.
2. **One evaluator, two seams.** The store -> environment -> default
   precedence lives in exactly one pure function (`evaluateFlags`); the sync
   and async front ends (`SyncFlagStore`/`AsyncFlagStore`) are the only
   variation point, matching each consumer's actual I/O model instead of
   forcing one shape on both.
3. **Seeding is atomic and never clobbers.** `seedMissing` inserts only
   missing keys in one atomic operation — never `load()` + `set()`, which
   would race a concurrent write and silently overwrite an admin's toggle.
4. **Fail open, loudly, with health.** A store `load()` failure never
   propagates out of `isEnabled`/`get`/`all` — it falls back per the
   flag's `onStoreError` policy and reports `health: 'store-unavailable'`,
   with an `onStoreError` callback so the fallback is never silent. Writes
   (`set`/`seed`) still throw on failure — a failed admin write must be
   loud.
5. **Types are a contract, tested.** `verify:pack` installs the tarball and
   resolves every export through both CJS and ESM. `defineFlags` makes an
   unknown flag key a compile error, asserted with a `@ts-expect-error` test.
6. **Uniform gates:** `test`, `verify:pack`, `typecheck` + `build` + dist freshness.
