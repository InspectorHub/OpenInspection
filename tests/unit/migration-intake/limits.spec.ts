/**
 * The size and row caps, and why they are not one number compiled in.
 *
 * This engine is deployed by people who do not run it the way we do. A self
 * hosted instance can sit on a plan whose per-request CPU budget is exhausted
 * by parsing a file our own number would have accepted, so shipping our number
 * as everyone's is shipping a limit that is wrong for half its readers. The
 * profile supplies a default per mode; the environment overrides it per
 * deployment. Neither is a literal in the intake path.
 */
import { describe, it, expect } from 'vitest';
import { getDeploymentProfile, SAAS_PROFILE, STANDALONE_PROFILE } from '../../../server/lib/deployment-profile';
import { assertRowCountWithin, assertSourceSizeWithin, limitsFor } from '../../../server/lib/migration-intake/limits';

describe('deployment defaults', () => {
    it('gives a self-hosted deployment the smaller defaults', () => {
        expect(STANDALONE_PROFILE.importMaxCsvBytes).toBeLessThan(SAAS_PROFILE.importMaxCsvBytes);
        expect(STANDALONE_PROFILE.importMaxRows).toBeLessThan(SAAS_PROFILE.importMaxRows);
        expect(STANDALONE_PROFILE.importMaxVendorExportBytes)
            .toBeLessThan(SAAS_PROFILE.importMaxVendorExportBytes);
    });

    it('every default is a positive integer, on both profiles', () => {
        // The control for the comparisons above: `undefined < undefined` is
        // false, so a profile missing all three would fail those tests — but a
        // profile carrying `0` and `1` would pass them while disabling the cap.
        for (const profile of [STANDALONE_PROFILE, SAAS_PROFILE]) {
            for (const cap of ['importMaxCsvBytes', 'importMaxVendorExportBytes', 'importMaxRows'] as const) {
                expect(Number.isInteger(profile[cap]), `${profile.mode}.${cap}`).toBe(true);
                expect(profile[cap], `${profile.mode}.${cap}`).toBeGreaterThan(0);
            }
        }
    });

    it('has no assisted route where there is nobody to assist', () => {
        expect(STANDALONE_PROFILE.hasAssistedMigration).toBe(false);
        expect(SAAS_PROFILE.hasAssistedMigration).toBe(true);
    });

    it('lets a deployment override every cap', () => {
        const profile = getDeploymentProfile({
            IMPORT_MAX_CSV_BYTES: '250000',
            IMPORT_MAX_VENDOR_EXPORT_BYTES: '500000',
            IMPORT_MAX_ROWS: '200',
        });
        expect(profile.importMaxCsvBytes).toBe(250_000);
        expect(profile.importMaxVendorExportBytes).toBe(500_000);
        expect(profile.importMaxRows).toBe(200);
    });

    it('overrides one cap without disturbing the other two', () => {
        // A `withImportLimits` that read the same env var three times would pass
        // the all-three case above and fail this one.
        const profile = getDeploymentProfile({ IMPORT_MAX_ROWS: '200' });
        expect(profile.importMaxRows).toBe(200);
        expect(profile.importMaxCsvBytes).toBe(STANDALONE_PROFILE.importMaxCsvBytes);
        expect(profile.importMaxVendorExportBytes).toBe(STANDALONE_PROFILE.importMaxVendorExportBytes);
    });

    it('ignores an override that is not a positive integer, rather than silently disabling the cap', () => {
        const profile = getDeploymentProfile({ IMPORT_MAX_ROWS: 'lots' });
        expect(profile.importMaxRows).toBe(STANDALONE_PROFILE.importMaxRows);
        const zero = getDeploymentProfile({ IMPORT_MAX_ROWS: '0' });
        expect(zero.importMaxRows).toBe(STANDALONE_PROFILE.importMaxRows);
        const negative = getDeploymentProfile({ IMPORT_MAX_ROWS: '-5' });
        expect(negative.importMaxRows).toBe(STANDALONE_PROFILE.importMaxRows);
        const fractional = getDeploymentProfile({ IMPORT_MAX_ROWS: '12.5' });
        expect(fractional.importMaxRows).toBe(STANDALONE_PROFILE.importMaxRows);
        const blank = getDeploymentProfile({ IMPORT_MAX_ROWS: '' });
        expect(blank.importMaxRows).toBe(STANDALONE_PROFILE.importMaxRows);
    });

    it('applies overrides on the saas profile too', () => {
        const profile = getDeploymentProfile({ APP_MODE: 'saas', IMPORT_MAX_ROWS: '42' });
        expect(profile.importMaxRows).toBe(42);
        expect(profile.hasAssistedMigration).toBe(true);
    });

    it('leaves the fields it was not asked about alone', () => {
        // The other half of `withImportLimits` spreading `base`: a version that
        // returned only the three caps would drop the derived tenant id and the
        // portal URLs, and every one of the tests above would still pass.
        const standalone = getDeploymentProfile({ SINGLE_TENANT_ID: 't-1', IMPORT_MAX_ROWS: '42' });
        expect(standalone.fixedTenantId).toBe('t-1');
        expect(standalone.mode).toBe('standalone');
        const saas = getDeploymentProfile({
            APP_MODE: 'saas', PORTAL_API_URL: 'https://portal.example/', IMPORT_MAX_ROWS: '42',
        });
        expect(saas.billingPortalUrl).toBe('https://portal.example');
        expect(saas.loginRedirectBase).toBe('https://portal.example');
    });
});

describe('limit assertions', () => {
    const limits = limitsFor(SAAS_PROFILE);

    it('carries the profile caps across without swapping them', () => {
        expect(limits.maxCsvBytes).toBe(SAAS_PROFILE.importMaxCsvBytes);
        expect(limits.maxVendorExportBytes).toBe(SAAS_PROFILE.importMaxVendorExportBytes);
        expect(limits.maxRows).toBe(SAAS_PROFILE.importMaxRows);
    });

    it('accepts a file at exactly the cap', () => {
        expect(() => assertSourceSizeWithin(limits, 'csv', limits.maxCsvBytes)).not.toThrow();
    });

    it('names the actual size and the cap when a csv is too big', () => {
        // Deliberately far over, so the two numbers in the message DIFFER. A
        // file one byte over rounds to the same megabyte figure as the cap, and
        // a message that printed the cap twice would pass that version of this
        // test while telling the operator nothing about their own file.
        expect(() => assertSourceSizeWithin(limits, 'csv', limits.maxCsvBytes * 3))
            .toThrow(new RegExp(`${Math.round(limits.maxCsvBytes * 3 / 1_000_000)} MB`));
        expect(() => assertSourceSizeWithin(limits, 'csv', limits.maxCsvBytes * 3))
            .toThrow(new RegExp(`${Math.round(limits.maxCsvBytes / 1_000_000)} MB`));
    });

    it('uses the vendor-export cap for a json source', () => {
        expect(() => assertSourceSizeWithin(limits, 'json', limits.maxCsvBytes + 1)).not.toThrow();
        expect(() => assertSourceSizeWithin(limits, 'json', limits.maxVendorExportBytes + 1)).toThrow();
    });

    it('reports the real row count, so the operator knows how far over they are', () => {
        expect(() => assertRowCountWithin(limits, limits.maxRows + 7))
            .toThrow(new RegExp(`${limits.maxRows + 7}`));
    });

    it('accepts a file at exactly the row cap', () => {
        expect(() => assertRowCountWithin(limits, limits.maxRows)).not.toThrow();
    });

    it('refuses as a 400, not a 500 — this is the operator\'s file, not our fault', () => {
        // The status matters: a 500 sends the operator to support and puts the
        // failure in our error budget, when what happened is that they picked a
        // file bigger than this deployment accepts.
        try {
            assertRowCountWithin(limits, limits.maxRows + 1);
            throw new Error('expected a refusal');
        } catch (err) {
            expect((err as { status?: number }).status).toBe(400);
        }
    });
});
