"use strict";
/**
 * @andrewpopov/feature-flags-kit — framework- and DB-agnostic feature flags.
 *
 * A pure evaluator (`evaluateFlags`) with a fixed precedence — store ->
 * environment -> registry default — plus two thin front ends over it:
 * `createSyncFlags` (live per-call reads, for a synchronous store like
 * better-sqlite3) and `createAsyncFlags` (an app-driven cached snapshot with
 * last-known-good degradation, for an async store like a Prisma-backed JSON
 * blob). `defineFlags` gives you a typed registry where an unknown key is a
 * compile error. Two adapters (`sql`, `blob`) are thin conveniences, not the
 * center of the package — bring your own store by implementing
 * `SyncFlagStore`/`AsyncFlagStore` directly.
 *
 * Env overrides default to `FEATURE_` + UPPER_SNAKE of the flag key (e.g.
 * `new.checkout` / `new-checkout` / `newCheckout` -> `FEATURE_NEW_CHECKOUT`),
 * both overridable via `envKey`/`parseBool` options.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createBlobFlagStore = exports.FEATURE_FLAGS_SCHEMA_SQL = exports.createSqlFlagStore = exports.createAsyncFlags = exports.createSyncFlags = exports.defineFlags = exports.defaultParseBool = exports.defaultEnvKey = exports.evaluateFlags = void 0;
var evaluate_1 = require("./evaluate");
Object.defineProperty(exports, "evaluateFlags", { enumerable: true, get: function () { return evaluate_1.evaluateFlags; } });
Object.defineProperty(exports, "defaultEnvKey", { enumerable: true, get: function () { return evaluate_1.defaultEnvKey; } });
Object.defineProperty(exports, "defaultParseBool", { enumerable: true, get: function () { return evaluate_1.defaultParseBool; } });
var registry_1 = require("./registry");
Object.defineProperty(exports, "defineFlags", { enumerable: true, get: function () { return registry_1.defineFlags; } });
var flags_1 = require("./flags");
Object.defineProperty(exports, "createSyncFlags", { enumerable: true, get: function () { return flags_1.createSyncFlags; } });
Object.defineProperty(exports, "createAsyncFlags", { enumerable: true, get: function () { return flags_1.createAsyncFlags; } });
var sql_1 = require("./adapters/sql");
Object.defineProperty(exports, "createSqlFlagStore", { enumerable: true, get: function () { return sql_1.createSqlFlagStore; } });
Object.defineProperty(exports, "FEATURE_FLAGS_SCHEMA_SQL", { enumerable: true, get: function () { return sql_1.FEATURE_FLAGS_SCHEMA_SQL; } });
var blob_1 = require("./adapters/blob");
Object.defineProperty(exports, "createBlobFlagStore", { enumerable: true, get: function () { return blob_1.createBlobFlagStore; } });
