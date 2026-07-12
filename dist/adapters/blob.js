"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createBlobFlagStore = createBlobFlagStore;
/**
 * Absence (`raw === null`, the row doesn't exist yet) is a healthy empty
 * store — every flag falls through to environment/default, `health` stays
 * `'ok'`. Corruption is NOT the same as absence: invalid JSON, a non-object
 * root, or a non-boolean value for a key all THROW, so the front ends treat
 * it as a store outage (`onStoreError` fires, `onStoreError` policy /
 * degraded health applies). Without this distinction a corrupted blob would
 * silently look like "no flags configured" and defeat any kill-switch.
 */
function parseBlob(raw) {
    if (raw === null)
        return {};
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (err) {
        throw new Error(`Feature-flag blob is malformed: invalid JSON (${err.message})`);
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        const kind = parsed === null ? 'null' : Array.isArray(parsed) ? 'array' : typeof parsed;
        throw new Error(`Feature-flag blob is malformed: expected a JSON object at the root, got ${kind}`);
    }
    const result = {};
    for (const [key, value] of Object.entries(parsed)) {
        if (typeof value !== 'boolean') {
            throw new Error(`Feature-flag blob is malformed: value for "${key}" is not a boolean (got ${typeof value})`);
        }
        result[key] = value;
    }
    return result;
}
/**
 * An `AsyncFlagStore` over a single-JSON-blob row. `set` and `seedMissing`
 * both go through `write(mutate)` so the read-modify-write happens inside
 * the host's transaction — never a separate read then a separate write.
 * `load` treats an absent row as a healthy empty store (`[]`), but THROWS on
 * a malformed blob — see `parseBlob`. The front ends already treat a
 * throwing `load()` as a store outage, so this is what fires
 * `onStoreError`/degrades health/engages the kill-switch on corruption.
 */
function createBlobFlagStore(driver) {
    return {
        async load() {
            const blob = parseBlob(await driver.read());
            return Object.entries(blob).map(([key, enabled]) => ({ key, enabled }));
        },
        async set(key, enabled) {
            await driver.write((current) => ({ ...current, [key]: enabled }));
        },
        async seedMissing(flags) {
            await driver.write((current) => {
                const next = { ...current };
                for (const flag of flags) {
                    if (!(flag.key in next))
                        next[flag.key] = flag.enabled;
                }
                return next;
            });
        },
    };
}
