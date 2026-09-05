/**
 * WHEN can an inspector be told a required box is empty?
 *
 * ── THE PRODUCTION FAILURE THIS PINS ────────────────────────────────────────
 * 2026-09-05, against the live deployment: a TREC inspection was created,
 * worked, and PUBLISHED TO THE CLIENT. Only the download afterwards said
 *
 *   "2 required field(s) have no answer: inspector_name, inspector_license_number"
 *
 * Neither field had anything to do with that inspection. `inspector_name` comes
 * from `users.name` and the licence from the credential rows; both were already
 * absent when the template was installed. The information existed the whole
 * time and arrived one irreversible step too late.
 *
 * So these assert the CLASSIFICATION, which is what decides where a person can
 * be warned. Getting it wrong in either direction has a specific cost:
 * a per-inspection fact called pre-inspection blocks work nobody can unblock
 * yet, and a profile fact called per-inspection puts the warning back after
 * publish, which is where it already was.
 */
import { describe, it, expect } from 'vitest';
import {
    provenanceOfBinding,
    PRE_INSPECTION_FACTS,
} from '../../../server/lib/statutory/fact-provenance';
import { fieldMap as trecMap } from '../../../server/lib/statutory/forms/tx-trec-rei-7-6';
import trecTemplate from '../../../server/data/seed-templates/trec-rei-7-6.json';

describe('when a missing statutory field could first have been answered', () => {
    it('calls the two fields that actually failed in production pre-inspection', () => {
        expect(provenanceOfBinding({ from: 'inspection', field: 'inspector_name' }))
            .toBe('pre_inspection');
        expect(provenanceOfBinding({ from: 'inspection', field: 'inspector_license' }))
            .toBe('pre_inspection');
    });

    it('calls a genuinely per-inspection fact per-inspection', () => {
        // The negative control. Without it, a classifier that answered
        // "pre_inspection" to everything would pass the assertion above and
        // gate template installation on the owner's name, the signing date and
        // the client -- none of which can be known before the job.
        for (const field of ['owner_name', 'inspector_signature_date', 'client_name'] as const) {
            expect(provenanceOfBinding({ from: 'inspection', field })).toBe('per_inspection');
        }
    });

    it('calls an answer on the page per-inspection', () => {
        expect(provenanceOfBinding({ from: 'item', itemId: 'foundations' } as never))
            .toBe('per_inspection');
        expect(provenanceOfBinding({ from: 'signature', scope: 'whole_form' } as never))
            .toBe('per_inspection');
    });

    it('does not guess when nothing says', () => {
        // `unknown` rather than a bucket: a fact whose provenance nobody stated
        // is not evidence that it is per-inspection, and defaulting the other
        // way would put it behind a gate before anyone decided it belonged.
        expect(provenanceOfBinding(undefined)).toBe('unknown');
        expect(provenanceOfBinding({ from: 'inspection' })).toBe('unknown');
    });

    it("splits TREC's own required fields exactly where production failed", () => {
        // Read from the SHIPPED map and the SHIPPED declaration, never from a
        // list written here. Two things fall out of that which a hand-written
        // list would have got wrong:
        //
        //   - `inspector_license_number` binds to the fact `inspector_license`.
        //     The names differ, so classifying by field NAME puts them in
        //     different buckets and gates the wrong one. This goes through the
        //     binding, which is why it lands right.
        //   - a revision that adds a required field arrives here as a failure
        //     rather than as an unclassified field nobody notices.
        // Under `schema`, where the declaration actually lives -- the same
        // place `inspections.template_snapshot` carries it at runtime.
        const bindings = (trecTemplate as {
            schema: { statutoryForm: { bindings: Record<string, { from: string; field?: string }> } };
        }).schema.statutoryForm.bindings;
        const byProvenance = new Map<string, string[]>();
        for (const field of trecMap.requiredFields) {
            const p = provenanceOfBinding(bindings[field]);
            byProvenance.set(p, [...(byProvenance.get(p) ?? []), field]);
        }

        // The two that reached an inspector only after the report was published.
        expect(byProvenance.get('pre_inspection')?.sort()).toEqual([
            'inspector_license_number', 'inspector_name',
        ]);
        // And the rest, which genuinely could not have been known earlier.
        expect(byProvenance.get('per_inspection')?.sort()).toEqual([
            'client_name', 'inspection_date', 'property_address',
        ]);
        // Nothing may fall through unclassified.
        expect(byProvenance.get('unknown') ?? []).toEqual([]);
    });

    it('names every pre-inspection fact as a real fact name', () => {
        // The set is hand-written against `gatherStatutoryInputs`. A typo would
        // otherwise match nothing and silently classify a profile fact as
        // per-inspection -- the exact regression this file exists to stop.
        expect(PRE_INSPECTION_FACTS.has('inspector_name')).toBe(true);
        expect(PRE_INSPECTION_FACTS.size).toBeGreaterThanOrEqual(6);
    });
});
