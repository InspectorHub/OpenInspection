import { describe, it, expect } from 'vitest';
import { version, fieldMap } from '../../../server/lib/statutory/forms/fl-citizens-roof';
import {
    version as fourPointVersion,
    fieldMap as fourPointMap,
} from '../../../server/lib/statutory/forms/fl-citizens-4point';
import {
    PUBLISHED_FORM_VERSIONS,
    FIELD_MAPS,
    EMPTY_CATALOGUE_REASON,
    fieldMapFor,
} from '../../../server/lib/statutory/forms';
import { versionForInspection } from '../../../server/lib/statutory/form-registry';

/**
 * Citizens roof inspection form, RCF-1 03 25.
 *
 * -- WHAT THESE ASSERTIONS ARE FOR -------------------------------------------
 * Not the coordinates -- a person signed for those. What is checkable is that
 * the software carries what they signed without alteration, and two properties
 * that a reader would otherwise have to take on trust: that the last page is
 * mapped, and that this form's roof blanks were measured on THIS document
 * rather than inherited from the four-point form that prints the same words.
 */
describe('FL Citizens roof RCF-1 03 25', () => {
    it('carries the signature of the person who read the form', () => {
        expect(fieldMap.checkedBy).toBe('Nathan');
        expect(fieldMap.checkedAt).toBe(Date.UTC(2026, 7, 30));
    });

    it('pins the revision and its map to ONE set of bytes', () => {
        expect(fieldMap.sourceHash).toBe(version.sourceHash);
        expect(version.sourceHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('names the FORM and not the revision', () => {
        expect(version.formId).toBe('fl_citizens_roof');
        expect(version.formId).not.toContain('rcf');
        expect(version.version).toBe('RCF-1 03 25');
    });

    it('carries every mapping the signed candidate carried, and no more', () => {
        expect(fieldMap.mappings).toHaveLength(60);
        const kinds = fieldMap.mappings.reduce<Record<string, number>>((acc, m) => {
            acc[m.kind] = (acc[m.kind] ?? 0) + 1;
            return acc;
        }, {});
        expect(kinds).toEqual({ overlay: 24, checkbox: 36 });
    });

    it('maps the LAST page, which carries eight real fill points', () => {
        // ⚠️ The habit of treating a statutory form's final page as a back
        // cover misses the entire signature block on this one. Named field by
        // field rather than counted, so a mapping that disappears is reported
        // as the box it was rather than as an arithmetic difference.
        const onPageTwo = fieldMap.mappings
            .filter((m) => m.kind === 'overlay' && m.page === 1)
            .map((m) => m.ourField)
            .sort();
        expect(onPageTwo).toEqual([
            'additional_comments',
            'inspector_company_name',
            'inspector_license_number',
            'inspector_license_type',
            'inspector_signature',
            'inspector_signature_date',
            'inspector_title',
            'inspector_work_phone',
        ]);
    });

    it('every overlay that measures its blank measures BOTH bounds', () => {
        const overlays = fieldMap.mappings.filter((m) => m.kind === 'overlay');
        const bothBounds = overlays.filter(
            (m) => m.kind === 'overlay' && m.maxWidth !== undefined && m.maxHeight !== undefined,
        );
        expect(overlays).toHaveLength(24);
        expect(bothBounds).toHaveLength(24);
    });

    it('did NOT inherit the four-point form\'s roof coordinates', () => {
        // The live example of the rule in `field-map.ts`. Both forms come from
        // one publisher, one bulletin and one set of roof field names -- and the
        // blanks are in different places. A map carried across would resolve
        // every name and print into the wrong boxes, raising nothing.
        const here = new Map(fieldMap.mappings
            .filter((m) => m.kind === 'overlay' && m.ourField.startsWith('roof['))
            .map((m) => [m.ourField, m] as const));
        const there = new Map(fourPointMap.mappings
            .filter((m) => m.kind === 'overlay' && m.ourField.startsWith('roof['))
            .map((m) => [m.ourField, m] as const));

        const shared = [...here.keys()].filter((k) => there.has(k));
        expect(shared.length).toBeGreaterThan(0);
        const moved = shared.filter((k) => {
            const a = here.get(k)!;
            const b = there.get(k)!;
            if (a.kind !== 'overlay' || b.kind !== 'overlay') return false;
            return a.x !== b.x || a.y !== b.y || a.page !== b.page || a.maxWidth !== b.maxWidth;
        });
        // Both numbers, so "they differ" is a count rather than a claim.
        expect(`${moved.length} of ${shared.length} moved`).toBe('12 of 12 moved');
        expect(version.sourceHash).not.toBe(fourPointVersion.sourceHash);
    });

    it('uses the publisher\'s own date, and was never made mandatory', () => {
        // ⚠️ `03 25` is MONTH-YEAR. The day comes from Citizens' 2025-03-20
        // bulletin, never from the revision string -- "March 25, 2025" is what
        // reading a day out of `03 25` produces, and it is not a date anybody
        // published.
        expect(version.effectiveFrom).toBe(Date.UTC(2025, 2, 20));
        expect(version.effectiveFrom).toBe(fourPointVersion.effectiveFrom);
        // Positive evidence, not a gap: the bulletin says an older version
        // "will not be rejected".
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

    it('does NOT resolve for an inspection dated before it existed', () => {
        expect(versionForInspection(
            version.formId, Date.UTC(2025, 0, 1), PUBLISHED_FORM_VERSIONS,
        )).toBeNull();
    });

    it('requires only what the form itself refuses a submission without', () => {
        // Two, against the four-point form's twenty-three, and the difference is
        // deliberate: this form prints one condition for rejecting a submission
        // and the required list says exactly that rather than a guess at what an
        // underwriter would want.
        expect(fieldMap.requiredFields).toEqual(['inspector_signature', 'inspector_signature_date']);
        const mapped = new Set(fieldMap.mappings.map((m) => m.ourField));
        for (const f of fieldMap.requiredFields) expect(mapped).toContain(f);
    });
});
