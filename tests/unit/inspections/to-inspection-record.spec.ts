/**
 * The two helpers a response uses to leave the company id out of a row: `withoutCompanyId` for any row, `toInspectionRecord` for an
 * inspection (which also reads the template snapshot as an object). Both return a copy and keep every other key.
 */
import { describe, it, expect } from 'vitest';
import { withoutCompanyId, toInspectionRecord, templateRecord } from '../../../server/lib/response-projection';

describe('withoutCompanyId', () => {
    it('drops the company id, keeps every other key, and leaves the row it was given as it was', () => {
        const row = { id: 'r1', tenantId: 'company-1', name: 'Urgent', nested: { tenantId: 'inner' }, empty: null };
        const out = withoutCompanyId(row);
        expect(out).toEqual({ id: 'r1', name: 'Urgent', nested: { tenantId: 'inner' }, empty: null });
        expect('tenantId' in out).toBe(false);
        expect(row.tenantId).toBe('company-1');
        expect(out).not.toBe(row);
    });

    it('control: a row with no company id comes back equal, and a Date value is kept as it is', () => {
        const when = new Date(0);
        const out = withoutCompanyId({ id: 'r2', when });
        expect(out).toEqual({ id: 'r2', when });
        expect(out.when).toBe(when);
    });
});

describe('toInspectionRecord', () => {
    const sections = [{ id: 's1', title: 'Roof', items: [] }];

    it('drops the company id, keeps the other keys, and does not change the row', () => {
        const row = { id: 'i1', tenantId: 'company-1', propertyAddress: '1 Main', templateSnapshot: { sections } };
        const out = toInspectionRecord(row);
        expect(out).toEqual({ id: 'i1', propertyAddress: '1 Main', templateSnapshot: { sections } });
        expect('tenantId' in out).toBe(false);
        expect(row.tenantId).toBe('company-1');
        expect(row.templateSnapshot).toEqual({ sections });
    });

    it('reads a snapshot stored as a JSON string as an object, and an unreadable one as null', () => {
        expect(toInspectionRecord({ id: 'i2', templateSnapshot: JSON.stringify({ sections }) }).templateSnapshot).toEqual({ sections });
        expect(toInspectionRecord({ id: 'i3', templateSnapshot: 'not json' }).templateSnapshot).toBeNull();
        expect(toInspectionRecord({ id: 'i4' }).templateSnapshot).toBeNull();
    });
});

describe('templateRecord', () => {
    it('drops the company id of a template row, and leaves a missing template as it was', () => {
        expect(templateRecord({ id: 't1', tenantId: 'company-1', name: 'Standard' })).toEqual({ id: 't1', name: 'Standard' });
        expect(templateRecord(null)).toBeNull();
        expect(templateRecord(undefined)).toBeUndefined();
    });
});
