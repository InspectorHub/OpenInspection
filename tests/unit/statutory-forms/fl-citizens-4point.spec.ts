import { describe, it, expect } from 'vitest';
import { version, fieldMap } from '../../../server/lib/statutory/forms/fl-citizens-4point';
import {
    PUBLISHED_FORM_VERSIONS,
    FIELD_MAPS,
    EMPTY_CATALOGUE_REASON,
    fieldMapFor,
} from '../../../server/lib/statutory/forms';
import { versionForInspection, selectableVersions } from '../../../server/lib/statutory/form-registry';

/**
 * Citizens four-point inspection form, Insp4pt 03 25.
 *
 * -- WHAT THESE ASSERTIONS ARE FOR -------------------------------------------
 * Not the coordinates. A person read the form and signed for those, and no test
 * can re-do that. What is checkable is that the software carries what they
 * signed WITHOUT ALTERATION, and that the surrounding declarations tell the
 * truth about it -- which is exactly the half that goes wrong quietly.
 */
describe('FL Citizens four-point Insp4pt 03 25', () => {
    it('carries the signature of the person who read the form', () => {
        expect(fieldMap.checkedBy).toBe('Nathan');
        expect(fieldMap.checkedAt).toBe(Date.UTC(2026, 7, 30));
    });

    it('pins the revision and its map to ONE set of bytes', () => {
        expect(fieldMap.sourceHash).toBe(version.sourceHash);
        expect(version.sourceHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('names the FORM and not the revision', () => {
        // `form-registry.ts`: a form id carrying a revision number cannot
        // express two revisions of one form being usable at once. The revision
        // label lives on its own field, where the selector reads it.
        expect(version.formId).toBe('fl_citizens_4point');
        expect(version.formId).not.toContain('03');
        expect(version.version).toBe('Insp4pt 03 25');
    });

    it('carries every mapping the signed candidate carried, and no more', () => {
        expect(fieldMap.mappings).toHaveLength(189);
        const kinds = fieldMap.mappings.reduce<Record<string, number>>((acc, m) => {
            acc[m.kind] = (acc[m.kind] ?? 0) + 1;
            return acc;
        }, {});
        // No acroform of any kind: this PDF carries no form fields at all, so
        // every value is drawn at a measured coordinate.
        expect(kinds).toEqual({ overlay: 51, checkbox: 138 });
    });

    it('every overlay that measures its blank measures BOTH bounds', () => {
        // A lone maxWidth is measured by nothing -- not by fit.ts, not at print
        // -- because text too long for a blank wraps DOWN rather than running
        // off the side. `validateFieldMapShape` refuses the pair being half
        // declared; this counts them, so "all of them declare both" is a number
        // rather than an inference from the absence of a throw.
        const overlays = fieldMap.mappings.filter((m) => m.kind === 'overlay');
        const bothBounds = overlays.filter(
            (m) => m.kind === 'overlay' && m.maxWidth !== undefined && m.maxHeight !== undefined,
        );
        expect(overlays).toHaveLength(51);
        expect(bothBounds).toHaveLength(51);
    });

    it('maps the page-1 detail box the form asks for when an answer is unsatisfactory', () => {
        // The form prints "If unsatisfactory, please provide comments/details"
        // over a blank area, and thirteen fields on it can be answered
        // `unsatisfactory`. Until this mapping existed the inspector was asked
        // for detail the software had nowhere to put.
        const detail = fieldMap.mappings.find(
            (m) => m.ourField === 'plumbing_fixtures_unsatisfactory_detail',
        );
        expect(detail).toBeDefined();
        expect(detail?.kind).toBe('overlay');
        // Page 2 of the printed form, 0-based. It is NOT `additional_comments`,
        // which is a different box under a different prompt on the next page.
        expect(detail?.kind === 'overlay' && detail.page).toBe(1);
        expect(fieldMap.mappings.some((m) => m.ourField === 'additional_comments')).toBe(true);
    });

    it('gives both electrical "other" answers somewhere to say what the other thing was', () => {
        // Both were once recorded as having no blank on the page at all. They
        // have one: 190.6 x 15.24 pt in the hazards cell after `Other (explain)`,
        // and 48.4 pt after the wiring row's `Other ` up to that cell's right
        // rule. Judged absent, an inspector cannot record something this form
        // lets him record; judged narrow, a long value is refused by name.
        const overlays = fieldMap.mappings.filter((m) => m.kind === 'overlay');
        const explain = overlays.find((m) => m.ourField === 'electrical.hazard_other_explain');
        const specify = overlays.find((m) => m.ourField === 'electrical.wiring_type_other_specify');
        expect(explain?.kind === 'overlay' && explain.maxWidth).toBe(190.6);
        expect(specify?.kind === 'overlay' && specify.maxWidth).toBe(48.4);
        // ⚠️ Both are ONE line. The cell rules they sit in are 15.24 and 13.86
        // points tall; two lines at 8pt occupy 14.8, so a second line lands
        // outside the printed cell on one of them and exactly fills the other.
        expect(explain?.kind === 'overlay' && explain.maxHeight).toBe(10.3);
        expect(specify?.kind === 'overlay' && specify.maxHeight).toBe(10.3);
        // And the boxes they explain are still boxes, on the same fields.
        const boxed = (field: string, whenValue: string) => fieldMap.mappings.some(
            (m) => m.kind === 'checkbox' && m.ourField === field && m.whenValue === whenValue,
        );
        expect(boxed('electrical.hazards_present', 'other_explain')).toBe(true);
        expect(boxed('electrical.wiring_types', 'other')).toBe(true);
    });

    it('asks for the SIGNING date at the signature block, not the inspection date', () => {
        // Page 1 already asks "Date Inspected:". The date under "I certify that
        // the above statements are true and correct" is a different question,
        // and signing routinely happens days after the visit.
        const names = new Set(fieldMap.mappings.map((m) => m.ourField));
        expect(names.has('date_inspected')).toBe(true);
        expect(names.has('inspector_signature_date')).toBe(true);
        expect(names.has('inspection_date')).toBe(false);
    });

    it('stops at page 2, because page 3 has no fill point on it', () => {
        // 0-based. The last page is instructions to agents and inspectors; that
        // was confirmed by rasterising it, not inferred from the map.
        for (const m of fieldMap.mappings) {
            if (m.kind === 'acroform' || m.kind === 'acroform_checkbox') continue;
            expect(m.page).toBeGreaterThanOrEqual(0);
            expect(m.page).toBeLessThanOrEqual(2);
        }
        const pages = new Set(fieldMap.mappings.map((m) => (m.kind === 'overlay'
            || m.kind === 'checkbox' || m.kind === 'signature' ? m.page : -1)));
        expect([...pages].sort()).toEqual([0, 1, 2]);
    });

    it('uses the publisher\'s own date, and was never made mandatory', () => {
        // Citizens' 2025-03-20 bulletin: begin using the updated forms
        // immediately; a submission on an older version "will not be rejected".
        expect(version.effectiveFrom).toBe(Date.UTC(2025, 2, 20));
        // ⚠️ POSITIVE EVIDENCE, NOT A GAP. Asserted so that anyone "completing"
        // it to match the other two forms has to delete this line and read why.
        expect(version.mandatoryFrom).toBeNull();
        expect(version.effectiveUntil).toBeNull();
        expect(version.withdrawn).toBeNull();
    });

    it('is listed in the catalogue, and the empty-catalogue reason is gone', () => {
        expect(PUBLISHED_FORM_VERSIONS).toContain(version);
        expect(FIELD_MAPS).toContain(fieldMap);
        expect(EMPTY_CATALOGUE_REASON).toBeNull();
    });

    it('resolves for an inspection dated after it became usable', () => {
        const picked = versionForInspection(
            version.formId, Date.UTC(2026, 5, 1), PUBLISHED_FORM_VERSIONS,
        );
        expect(picked?.version).toBe(version.version);
        expect(fieldMapFor(picked!.formId, picked!.version)).toBe(fieldMap);
    });

    it('is still the default even though nothing mandates it', () => {
        // The registry's answer when every selectable revision is voluntary is
        // the INCUMBENT, not "no default". A null mandatoryFrom therefore keeps
        // the form usable rather than making it unreachable, which is why it
        // does not need an invented date.
        const usable = selectableVersions(
            version.formId, Date.UTC(2026, 5, 1), PUBLISHED_FORM_VERSIONS,
        );
        expect(usable.map((v) => v.version)).toEqual([version.version]);
        expect(usable.every((v) => v.mandatoryFrom === null)).toBe(true);
    });

    it('does NOT resolve for an inspection dated before it existed', () => {
        // The positive control for the assertion above: a selector that
        // returned this revision for any date would satisfy that one perfectly.
        expect(versionForInspection(
            version.formId, Date.UTC(2025, 0, 1), PUBLISHED_FORM_VERSIONS,
        )).toBeNull();
    });

    it('names its required fields, and each one is actually mapped', () => {
        expect(fieldMap.requiredFields).toHaveLength(23);
        const mapped = new Set(fieldMap.mappings.map((m) => m.ourField));
        for (const f of fieldMap.requiredFields) expect(mapped).toContain(f);
    });
});
