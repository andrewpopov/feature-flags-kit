"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defineFlags = defineFlags;
const evaluate_1 = require("./evaluate");
/**
 * Declare a flag registry, preserving the literal key union so
 * `flags.isEnabled('typo')` is a TYPE ERROR rather than a silent runtime
 * fallback to the default. Throws at definition time on a duplicate key.
 */
function defineFlags(defs, options = {}) {
    const seen = new Set();
    const envKeys = new Map();
    const envKey = options.envKey ?? evaluate_1.defaultEnvKey;
    const aliases = new Set(options.allowEnvKeyAliases ?? []);
    for (const def of defs) {
        if (seen.has(def.key)) {
            throw new Error(`defineFlags: duplicate flag key "${def.key}"`);
        }
        seen.add(def.key);
        const normalizedEnvKey = envKey(def.key);
        const existingKey = envKeys.get(normalizedEnvKey);
        if (existingKey && !aliases.has(normalizedEnvKey)) {
            throw new Error(`defineFlags: keys "${existingKey}" and "${def.key}" both map to environment variable "${normalizedEnvKey}"`);
        }
        envKeys.set(normalizedEnvKey, def.key);
    }
    return defs;
}
