/**
 * Format-version upgrader registry and known-fingerprint decisions for import.
 *
 * A package's manifest declares a `formatVersion` (file layout) and a
 * `columnFingerprint` (schema shape). Three decisions live here:
 *   1. A package NEWER than the target is refused — never guess at an unknown
 *      future layout.
 *   2. An OLDER package may be migrated forward through registered, pure row
 *      upgraders, within a bounded window (2 layout versions or 6 months of
 *      schemaVersion, whichever is fewer; here the layout count is the binding
 *      constraint).
 *   3. A fingerprint matching neither the current schema nor a committed
 *      known-old fingerprint is an "unknown shape" and is refused.
 *
 * The registry is intentionally empty at v1 — there is no older layout to
 * upgrade from yet. Upgraders are added as new format versions ship, each a
 * pure function over one row with its own fixture and test. Keeping the
 * mechanism now (rather than when v2 arrives) means the preflight/apply path
 * can already make the right refuse/accept decision without a later rewrite.
 */
import { FORMAT_VERSION } from '@core/data-package';
import knownFingerprints from './known-fingerprints.json';

export { FORMAT_VERSION };

/** Largest forward jump (in format versions) the importer will migrate. */
export const UPGRADER_WINDOW = 2;

/** A pure row transform: vN row -> v(N+1) row. No I/O, no clock, no randomness. */
export type RowUpgrader = (row: Record<string, unknown>) => Record<string, unknown>;

/** source formatVersion -> the upgrader that produces the next version. */
const REGISTRY: ReadonlyMap<number, RowUpgrader> = new Map<number, RowUpgrader>();

/** Refuse a package whose layout is newer than this engine reads. */
export function assertNotNewer(packageVersion: number, targetVersion: number = FORMAT_VERSION): void {
    if (!Number.isInteger(packageVersion) || !Number.isInteger(targetVersion)) {
        throw new Error('format versions must be integers');
    }
    if (packageVersion > targetVersion) {
        throw new Error(
            `package format ${packageVersion} is newer than this engine reads (${targetVersion}); upgrade first`,
        );
    }
}

/**
 * The ordered upgrader chain from `from` (inclusive) to `to` (exclusive).
 * Returns [] when the versions match; throws when the jump exceeds the window,
 * goes backwards, or a required upgrader is not registered.
 */
export function upgradePath(from: number, to: number): RowUpgrader[] {
    if (!Number.isInteger(from) || !Number.isInteger(to)) throw new Error('format versions must be integers');
    if (from > to) throw new Error(`cannot downgrade a package from v${from} to v${to}`);
    if (from === to) return [];
    if (to - from > UPGRADER_WINDOW) {
        throw new Error(`upgrade from v${from} to v${to} exceeds the ${UPGRADER_WINDOW}-version window`);
    }
    const path: RowUpgrader[] = [];
    for (let v = from; v < to; v++) {
        const upgrader = REGISTRY.get(v);
        if (!upgrader) throw new Error(`no upgrader registered from v${v} to v${v + 1}`);
        path.push(upgrader);
    }
    return path;
}

/** Apply an upgrader chain to one row without mutating the input. */
export function applyUpgraders(
    row: Record<string, unknown>,
    path: readonly RowUpgrader[],
): Record<string, unknown> {
    let out = row;
    for (const upgrader of path) out = upgrader(out);
    return out;
}

export type FingerprintClass = 'current' | 'known-old' | 'unknown';

/** Classify a package fingerprint against the current schema and the committed known-old set. */
export function classifyFingerprint(
    fingerprint: string,
    currentFingerprint: string,
    knownOld: readonly string[] = knownFingerprints.fingerprints,
): FingerprintClass {
    if (fingerprint === currentFingerprint) return 'current';
    if (knownOld.includes(fingerprint)) return 'known-old';
    return 'unknown';
}
