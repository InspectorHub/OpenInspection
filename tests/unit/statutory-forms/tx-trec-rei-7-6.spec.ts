import { describe, it, expect } from 'vitest';
import { version, fieldMap } from '../../../server/lib/statutory/forms/tx-trec-rei-7-6';
import {
    PUBLISHED_FORM_VERSIONS,
    FIELD_MAPS,
    EMPTY_CATALOGUE_REASON,
    fieldMapFor,
} from '../../../server/lib/statutory/forms';
import { versionForInspection } from '../../../server/lib/statutory/form-registry';
import seed from '../../../server/data/seed-templates/trec-rei-7-6.json';

/**
 * The first statutory form this software publishes.
 *
 * -- WHAT THESE ASSERTIONS ARE FOR -------------------------------------------
 * Not the coordinates. A person read the form and signed for those, and no test
 * can re-do that. What is checkable is that the software carries what they
 * signed WITHOUT ALTERATION, and that the surrounding declarations tell the
 * truth about it — which is exactly the half that goes wrong quietly.
 */
describe('TX TREC REI 7-6', () => {
    it('carries the signature of the person who read the form', () => {
        expect(fieldMap.checkedBy).toBe('Nathan');
        expect(fieldMap.checkedAt).toBe(Date.UTC(2026, 7, 29));
    });

    it('pins the revision and its map to ONE set of bytes', () => {
        // A map inherited from another revision is the failure this subsystem is
        // built around: the names resolve, the boxes are in different places, and
        // the document comes out looking filled.
        expect(fieldMap.sourceHash).toBe(version.sourceHash);
        expect(version.sourceHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('carries every mapping the signed candidate carried, and no more', () => {
        // 245 = 81 acroform text widgets + 164 checkboxes, counted twice over
        // (PyMuPDF and pdf-lib) when the candidate was authored.
        expect(fieldMap.mappings).toHaveLength(245);
        const kinds = fieldMap.mappings.reduce<Record<string, number>>((acc, m) => {
            acc[m.kind] = (acc[m.kind] ?? 0) + 1;
            return acc;
        }, {});
        expect(kinds).toEqual({ acroform: 81, checkbox: 164 });
    });

    it('uses the authority\'s own dates, voluntary before mandatory', () => {
        // TREC: usable voluntarily from 2021-09-01, required from 2022-02-01.
        expect(version.effectiveFrom).toBe(Date.UTC(2021, 8, 1));
        expect(version.mandatoryFrom).toBe(Date.UTC(2022, 1, 1));
        expect(version.effectiveUntil).toBeNull();
        expect(version.withdrawnAt).toBeNull();
    });

    it('is listed in the catalogue, and the empty-catalogue reason is gone', () => {
        expect(PUBLISHED_FORM_VERSIONS).toContain(version);
        expect(FIELD_MAPS).toContain(fieldMap);
        // A reason that outlives the emptiness it explains is a stale
        // explanation of a state that no longer holds.
        expect(EMPTY_CATALOGUE_REASON).toBeNull();
    });

    it('resolves for an inspection dated after it became usable', () => {
        const picked = versionForInspection(
            'tx_trec_rei_7_6', Date.UTC(2026, 5, 1), PUBLISHED_FORM_VERSIONS,
        );
        expect(picked?.version).toBe(version.version);
        expect(fieldMapFor(picked!.formId, picked!.version)).toBe(fieldMap);
    });

    it('does NOT resolve for an inspection dated before it existed', () => {
        // The positive control for the assertion above: a selector that returned
        // this revision for any date would satisfy that one perfectly.
        expect(versionForInspection(
            'tx_trec_rei_7_6', Date.UTC(2021, 0, 1), PUBLISHED_FORM_VERSIONS,
        )).toBeNull();
    });

    it('every checkbox mapping names a page this six-page form has', () => {
        // `page` is 0-based. A mapping past the end draws nothing and says nothing.
        for (const m of fieldMap.mappings) {
            // Both routes into a fillable form are addressed by NAME and carry
            // no geometry of their own; the widget's rectangle is the form's.
            if (m.kind === 'acroform' || m.kind === 'acroform_checkbox') continue;
            expect(m.page).toBeGreaterThanOrEqual(0);
            expect(m.page).toBeLessThan(6);
        }
    });

    it('names its required fields, and each one is actually mapped', () => {
        // A required field with no mapping is refused at render time — but that
        // refusal arrives when an inspector presses the button, not here.
        expect(fieldMap.requiredFields.length).toBeGreaterThan(0);
        const mapped = new Set(fieldMap.mappings.map((m) => m.ourField));
        for (const f of fieldMap.requiredFields) expect(mapped).toContain(f);
    });

    it('is reachable: the seed template declares it, and binds what it must', () => {
        // This replaced an assertion that existed to be DELETED. It read
        // `expect(ourFields.size).toBe(122)` and was placed here so that
        // whoever wired the bindings had to come back and remove it, rather
        // than the gap being discovered by a workspace that installed the pack
        // and found `available: false`. The bindings are wired now, so the
        // marker is gone and what stands in its place is the property it was
        // standing in for.
        //
        // The correspondence itself -- every binding against every field -- is
        // asserted in `trec-seed-template.spec.ts`, beside the template. Here
        // we only record that a template claims this form at all.
        const decl = (seed.schema as unknown as {
            statutoryForm?: { formId: string; revision?: string };
        }).statutoryForm;
        expect(decl?.formId).toBe('tx_trec_rei');
        expect(decl?.revision).toBe('7-6');
    });
});
