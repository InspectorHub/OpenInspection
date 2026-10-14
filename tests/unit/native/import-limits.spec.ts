/**
 * The import limits: what the defaults promise, how the environment overrides
 * them, and that a bad value can never switch a limit off.
 */
import { describe, it, expect } from 'vitest';
import {
    DEFAULT_IMPORT_LIMITS, IMPORT_LIMIT_CEILINGS, estimateSubrequests, packageTooLarge, readImportLimits,
} from '../../../server/lib/native/import-limits';

/** Workers Free: subrequests allowed per invocation. */
const FREE_SUBREQUEST_CEILING = 1000;

describe('default import limits', () => {
    it('admit a largest package whose estimated subrequests stay well under the Free ceiling', () => {
        const estimate = estimateSubrequests(DEFAULT_IMPORT_LIMITS);
        expect(estimate).toBe(70 + 8 * 22 + 20 * 20 + 50 * 3);
        expect(estimate).toBeLessThanOrEqual(0.8 * FREE_SUBREQUEST_CEILING);
    });

    it('leave room in the entry count for every photo, Yjs state and the three JSON entries', () => {
        const { inspections, photos, entries } = DEFAULT_IMPORT_LIMITS;
        expect(inspections + photos + 3).toBeLessThanOrEqual(entries);
    });

    it('sit inside the ceilings (positive control: the estimate formula does grow with the ceilings)', () => {
        for (const name of Object.keys(DEFAULT_IMPORT_LIMITS) as Array<keyof typeof DEFAULT_IMPORT_LIMITS>) {
            expect(DEFAULT_IMPORT_LIMITS[name]).toBeLessThanOrEqual(IMPORT_LIMIT_CEILINGS[name]);
        }
        expect(estimateSubrequests(IMPORT_LIMIT_CEILINGS)).toBeGreaterThan(FREE_SUBREQUEST_CEILING);
    });
});

describe('readImportLimits', () => {
    it('returns the defaults for an empty environment', () => {
        expect(readImportLimits({})).toEqual(DEFAULT_IMPORT_LIMITS);
    });

    it('reads every variable', () => {
        expect(readImportLimits({
            NATIVE_IMPORT_MAX_COMPRESSED_BYTES: '1048576',
            NATIVE_IMPORT_MAX_UNCOMPRESSED_BYTES: '2097152',
            NATIVE_IMPORT_MAX_ENTRIES: '50',
            NATIVE_IMPORT_MAX_INSPECTIONS: '3',
            NATIVE_IMPORT_MAX_OUTBOX: '5',
            NATIVE_IMPORT_MAX_PHOTOS: '7',
        })).toEqual({ compressedBytes: 1048576, uncompressedBytes: 2097152, entries: 50, inspections: 3, outbox: 5, photos: 7 });
    });

    it('trims whitespace', () => {
        expect(readImportLimits({ NATIVE_IMPORT_MAX_OUTBOX: ' 40 ' }).outbox).toBe(40);
    });

    it.each(['', '   ', 'abc', '12abc', '1.5', '-3', '1e3', '0x10', 'Infinity', 'NaN', '99999999999999999999'])(
        'falls back to the default for %j instead of throwing or disabling the limit', (value) => {
            expect(readImportLimits({ NATIVE_IMPORT_MAX_OUTBOX: value, NATIVE_IMPORT_MAX_PHOTOS: value }))
                .toMatchObject({ outbox: DEFAULT_IMPORT_LIMITS.outbox, photos: DEFAULT_IMPORT_LIMITS.photos });
        },
    );

    it('clamps an extreme value into the allowed range', () => {
        const high = readImportLimits({ NATIVE_IMPORT_MAX_OUTBOX: '1000000', NATIVE_IMPORT_MAX_COMPRESSED_BYTES: '999999999999' });
        expect(high.outbox).toBe(IMPORT_LIMIT_CEILINGS.outbox);
        expect(high.compressedBytes).toBe(IMPORT_LIMIT_CEILINGS.compressedBytes);
        const low = readImportLimits({ NATIVE_IMPORT_MAX_OUTBOX: '0', NATIVE_IMPORT_MAX_PHOTOS: '0', NATIVE_IMPORT_MAX_COMPRESSED_BYTES: '1' });
        expect(low.outbox).toBe(1);
        expect(low.photos).toBe(1);
        expect(low.compressedBytes).toBeGreaterThan(1);
    });
});

describe('packageTooLarge', () => {
    const limits = readImportLimits({});

    it('is 422 for a count and carries what a client needs to split the package', () => {
        const err = packageTooLarge({ limit: 'outbox', max: 20, actual: 21 }, limits);
        expect(err.status).toBe(422);
        expect(err.code).toBe('PACKAGE_TOO_LARGE');
        expect(err.details).toEqual({
            limit: 'outbox', max: 20, actual: 21,
            limits: { inspections: 8, outbox: 20, photos: 50, compressedBytes: DEFAULT_IMPORT_LIMITS.compressedBytes },
        });
    });

    it('is 413 for a size', () => {
        expect(packageTooLarge({ limit: 'compressedBytes', max: 10, actual: 11 }, limits).status).toBe(413);
        expect(packageTooLarge({ limit: 'uncompressedBytes', max: 10, actual: 11 }, limits).status).toBe(413);
    });
});
