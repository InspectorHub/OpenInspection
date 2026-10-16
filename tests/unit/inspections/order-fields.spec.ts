/**
 * The order / inspection field split, walked key by key over the real PATCH schema.
 *
 * Every key `UpdateInspectionSchema` accepts must be named on exactly one side. A new
 * key that nobody classified turns the first test red, which is the point: an
 * unclassified key would otherwise be decided by whoever happens to read the code.
 */
import { describe, it, expect } from 'vitest';
import {
    ORDER_FIELDS, ATTRIBUTE_FIELDS, INSPECTION_SIDE_FIELDS, STAFF_ORDER_STATUSES, LOCKED_AFTER_SUBMIT, GATE_FIELDS,
    inspectionStarted, classifyStaffPatch, sideOf, changedKeys, sameMoment, type StaffPatchState,
} from '../../../server/lib/inspection/order-fields';
import { UpdateInspectionSchema } from '../../../server/lib/validations/inspection.schema';

const schemaKeys = Object.keys(UpdateInspectionSchema.shape);

const state = (over: Partial<StaffPatchState> = {}): StaffPatchState => ({
    status: 'scheduled', reportStatus: 'in_progress', started: false, paymentRequired: true, agreementRequired: true, ...over,
});

describe('field classification', () => {
    it('names every key of the PATCH schema on exactly one side', () => {
        // A schema that lost its keys would turn the checks below into loops over nothing.
        expect(schemaKeys.length).toBe(28);
        const all = [...ORDER_FIELDS, ...ATTRIBUTE_FIELDS, ...INSPECTION_SIDE_FIELDS];
        expect(new Set(all).size).toBe(all.length);
        expect(schemaKeys.filter((k) => !(all as readonly string[]).includes(k))).toEqual([]);
        expect(all.filter((k) => !schemaKeys.includes(k))).toEqual([]);
    });

    it('sideOf agrees with the lists, and an unknown key is on the inspection side', () => {
        for (const k of ORDER_FIELDS) expect(sideOf(k)).toBe('order');
        for (const k of ATTRIBUTE_FIELDS) expect(sideOf(k)).toBe('attribute');
        for (const k of INSPECTION_SIDE_FIELDS) expect(sideOf(k)).toBe('inspection');
        expect(sideOf('somethingNew')).toBe('inspection');
    });
});

describe('inspectionStarted', () => {
    const base = { status: 'scheduled', reportStatus: 'in_progress', hasResultKeys: false };
    it('is false for a booking nobody has touched', () => expect(inspectionStarted(base)).toBe(false));
    it('is true when the report left in_progress', () => {
        for (const reportStatus of ['submitted', 'published']) expect(inspectionStarted({ ...base, reportStatus })).toBe(true);
    });
    it('is true when the visit is completed', () => expect(inspectionStarted({ ...base, status: 'completed' })).toBe(true));
    it('is true when the results row holds a key', () => expect(inspectionStarted({ ...base, hasResultKeys: true })).toBe(true));
});

describe('classifyStaffPatch', () => {
    it('lets every order key through, one at a time', () => {
        const samples: Record<string, unknown> = {
            date: '2026-07-01', inspectorId: 'u1', price: 100, depositRequiredCents: 5, paymentRequired: true, agreementRequired: true,
            referenceNumber: 'R1', referralSource: 'Realtor', referredByContactId: 'c1', closingDate: '2026-08-01',
            propertyAddress: '9 New Street', status: 'confirmed',
        };
        expect(Object.keys(samples).sort()).toEqual([...ORDER_FIELDS].sort());
        for (const [k, v] of Object.entries(samples)) {
            expect(classifyStaffPatch({ [k]: v }, state({ paymentRequired: false, agreementRequired: false })).ok, k).toBe(true);
        }
    });

    it('refuses every inspection-side key, one at a time, naming it', () => {
        for (const k of INSPECTION_SIDE_FIELDS) {
            const v = classifyStaffPatch({ [k]: 'x' }, state());
            expect(v, k).toEqual({ ok: false, reason: 'inspection_side_field', keys: [k] });
        }
        // The six that matter most are exactly the ones above.
        expect([...INSPECTION_SIDE_FIELDS].sort()).toEqual([
            'autoSignOnPublish', 'badgeLayoutOverride', 'coverPhotoId', 'profileOverride', 'reportPhotoColumns', 'requireDefectFieldsOverride',
        ]);
    });

    it('refuses a key nobody classified', () => {
        expect(classifyStaffPatch({ brandNewColumn: 1 }, state())).toEqual({ ok: false, reason: 'inspection_side_field', keys: ['brandNewColumn'] });
    });

    it('attribute keys pass before the inspection starts and are refused after', () => {
        for (const k of ATTRIBUTE_FIELDS) {
            expect(classifyStaffPatch({ [k]: 1 }, state({ started: false })).ok, `${k} before`).toBe(true);
            expect(classifyStaffPatch({ [k]: 1 }, state({ started: true })), `${k} after`).toEqual({ ok: false, reason: 'attribute_locked', keys: [k] });
        }
    });

    it('who, where and when are refused after the inspection starts, and pass before', () => {
        for (const k of LOCKED_AFTER_SUBMIT) {
            expect(classifyStaffPatch({ [k]: 'new-value-1' }, state({ started: false })).ok, `${k} before`).toBe(true);
            expect(classifyStaffPatch({ [k]: 'new-value-1' }, state({ started: true })), `${k} after`).toEqual({ ok: false, reason: 'started_locked', keys: [k] });
        }
        // Control: an order key outside that list stays writable after the start.
        expect(classifyStaffPatch({ referenceNumber: 'R2' }, state({ started: true })).ok).toBe(true);
    });

    it('status: only order statuses, and never out of completed', () => {
        for (const s of STAFF_ORDER_STATUSES) {
            expect(classifyStaffPatch({ status: s }, state({ status: s === 'scheduled' ? 'requested' : 'scheduled' })).ok, s).toBe(true);
            expect(classifyStaffPatch({ status: s }, state({ status: 'completed' })), s).toEqual({ ok: false, reason: 'status_regress', keys: ['status'] });
        }
        for (const s of ['completed', 'cancelled']) {
            expect(classifyStaffPatch({ status: s }, state()), s).toEqual({ ok: false, reason: 'status_not_order', keys: ['status'] });
        }
    });

    it('requirements: switching on passes, switching off is refused', () => {
        for (const k of GATE_FIELDS) {
            expect(classifyStaffPatch({ [k]: true }, state({ paymentRequired: false, agreementRequired: false })).ok, `${k} on`).toBe(true);
            expect(classifyStaffPatch({ [k]: false }, state()), `${k} off`).toEqual({ ok: false, reason: 'gate_off', keys: [k] });
        }
        // Switching off what is already off removes nothing.
        expect(classifyStaffPatch({ paymentRequired: false }, state({ paymentRequired: false })).ok).toBe(true);
    });

    it('a value equal to the stored one is not a change, whatever its side', () => {
        const stored = { coverPhotoId: 'k1', status: 'completed', propertyAddress: '1 Main St', autoSignOnPublish: false };
        const v = classifyStaffPatch(
            { coverPhotoId: 'k1', status: 'completed', autoSignOnPublish: false, propertyAddress: '1 Main St' },
            state({ status: 'completed', started: true, stored }),
        );
        expect(v).toEqual({ ok: true, changed: [] });
        // Control: the same body with one real change is refused for that key only.
        expect(classifyStaffPatch({ coverPhotoId: 'k2', status: 'completed' }, state({ status: 'completed', stored })))
            .toEqual({ ok: false, reason: 'inspection_side_field', keys: ['coverPhotoId'] });
    });

    it('a mixed body is refused as a whole and the reason names the offending keys', () => {
        const v = classifyStaffPatch({ price: 10, coverPhotoId: 'k', referenceNumber: 'R' }, state());
        expect(v).toEqual({ ok: false, reason: 'inspection_side_field', keys: ['coverPhotoId'] });
    });
});

describe('changedKeys and sameMoment', () => {
    it('treats null and undefined stored values alike, and skips undefined body values', () => {
        expect(changedKeys({ county: null, unit: undefined, sqft: 5 }, { county: undefined, unit: 'x', sqft: null })).toEqual(['sqft']);
    });
    it('compares dates by day, and by instant when a time is sent', () => {
        expect(sameMoment('2026-06-01', '2026-06-01')).toBe(true);
        expect(sameMoment('2026-06-01T09:00:00.000Z', '2026-06-01')).toBe(true);
        expect(sameMoment('2026-06-01', '2026-06-01T09:00:00.000Z')).toBe(false);
        expect(sameMoment('2026-06-01', '2026-06-02')).toBe(false);
    });
});
