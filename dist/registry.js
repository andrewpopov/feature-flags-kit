"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defineFlags = defineFlags;
/**
 * Declare a flag registry, preserving the literal key union so
 * `flags.isEnabled('typo')` is a TYPE ERROR rather than a silent runtime
 * fallback to the default. Throws at definition time on a duplicate key.
 */
function defineFlags(defs) {
    const seen = new Set();
    for (const def of defs) {
        if (seen.has(def.key)) {
            throw new Error(`defineFlags: duplicate flag key "${def.key}"`);
        }
        seen.add(def.key);
    }
    return defs;
}
