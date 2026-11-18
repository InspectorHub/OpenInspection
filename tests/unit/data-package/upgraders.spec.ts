/**
 * Format-version upgrader registry and known-fingerprint tests.
 *
 * The package manifest carries a formatVersion (file layout) and a schema
 * fingerprint. A package newer than the target is refused outright; an older
 * one may be migrated forward through registered, pure row upgraders inside a
 * bounded window; a fingerprint that matches neither the current schema nor a
 * committed known-old fingerprint is an "unknown shape" and is refused.
 *
 * The fingerprint algorithm itself (columnSetFingerprint) has its own tests in
 * the shared package; here we test the version/window and registry decisions.
 */
import { describe, it, expect } from 'vitest';
import {
    FORMAT_VERSION,
    UPGRADER_WINDOW,
    upgradePath,
    assertNotNewer,
    classifyFingerprint,
    applyUpgraders,
    type RowUpgrader,
} from '../../../server/lib/data-package/upgraders';

describe('format-version window', () => {
    it('accepts the current version with an empty upgrade path', () => {
        expect(upgradePath(FORMAT_VERSION, FORMAT_VERSION)).toEqual([]);
        expect(() => assertNotNewer(FORMAT_VERSION, FORMAT_VERSION)).not.toThrow();
    });

    it('refuses a package newer than the target', () => {
        expect(() => assertNotNewer(FORMAT_VERSION + 1, FORMAT_VERSION)).toThrow(/newer/i);
    });

    it('refuses a downgrade and a jump beyond the window', () => {
        expect(() => upgradePath(FORMAT_VERSION, FORMAT_VERSION - 1)).toThrow();
        expect(() => upgradePath(1, 1 + UPGRADER_WINDOW + 1)).toThrow(/window/i);
    });

    it('has no upgrade path from v1 today (v1 is the only layout)', () => {
        // The committed registry is empty; a one-version jump has no upgrader.
        expect(() => upgradePath(1, 2)).toThrow(/upgrader/i);
    });
});

describe('pure row upgraders', () => {
    it('applies a chain in order and never mutates the input', () => {
        const v1to2: RowUpgrader = (row) => ({ ...row, migrated: 'v2' });
        const v2to3: RowUpgrader = (row) => ({ ...row, migrated: `${String(row.migrated)}+v3` });
        const input = { id: 'a' };
        const out = applyUpgraders(input, [v1to2, v2to3]);
        expect(out).toEqual({ id: 'a', migrated: 'v2+v3' });
        expect(input).toEqual({ id: 'a' }); // input untouched
    });
});

describe('known fingerprint classification', () => {
    const CURRENT = 'a'.repeat(64);
    const OLD_KNOWN = 'b'.repeat(64);
    const UNKNOWN = 'c'.repeat(64);
    const knownOld = [OLD_KNOWN];

    it('classifies current, known-old and unknown fingerprints', () => {
        expect(classifyFingerprint(CURRENT, CURRENT, knownOld)).toBe('current');
        expect(classifyFingerprint(OLD_KNOWN, CURRENT, knownOld)).toBe('known-old');
        expect(classifyFingerprint(UNKNOWN, CURRENT, knownOld)).toBe('unknown');
    });
});
