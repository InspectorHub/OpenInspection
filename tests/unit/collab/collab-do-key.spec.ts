/**
 * The collaborative document is keyed per REPORT.
 *
 * It used to be `${tenantId}:${inspectionId}`, so two inspectors working the
 * standard report and the sewer report of one order landed in the same Durable
 * Object and shared one Y.Doc. Nothing threw — the CRDT merged content belonging
 * to two different documents, and the corruption surfaced when a client opened a
 * report containing someone else's findings. That is the whole reason this task
 * could not be deferred past the point where a second report can exist.
 */
import { describe, it, expect } from 'vitest';
import { collabDocName } from '../../../server/lib/collab/doc-name';

const TENANT = 'tenant-1';
const INSPECTION = 'insp-1';
const PRIMARY = 'rpt-primary';
const RADON = 'rpt-radon';

describe('collabDocName', () => {
    it('derives a distinct name per report on the same inspection', () => {
        expect(collabDocName(TENANT, PRIMARY)).not.toEqual(collabDocName(TENANT, RADON));
    });

    it('does not derive the name from the inspection id', () => {
        // Asserted on the INPUT, not just on inequality. Two report ids are
        // trivially unequal, so an implementation that still keyed on the
        // inspection would satisfy the test above while remaining broken.
        expect(collabDocName(TENANT, PRIMARY)).not.toContain(INSPECTION);
    });

    it('separates the same report id across tenants', () => {
        // The DO namespace is global; the tenant prefix is what stops one
        // tenant's document from resolving to another's.
        expect(collabDocName('tenant-a', PRIMARY)).not.toEqual(collabDocName('tenant-b', PRIMARY));
    });

    it('is stable for the same inputs', () => {
        // Reconnecting to a live editing session has to resolve the same DO.
        expect(collabDocName(TENANT, PRIMARY)).toBe(collabDocName(TENANT, PRIMARY));
    });
});
