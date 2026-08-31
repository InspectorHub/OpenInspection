import { describe, it, expect } from 'vitest';
import { version, fieldMap } from '../../../server/lib/statutory/forms/fl-oir-b1-1802';
import {
    PUBLISHED_FORM_VERSIONS,
    FIELD_MAPS,
    EMPTY_CATALOGUE_REASON,
    fieldMapFor,
} from '../../../server/lib/statutory/forms';
import { versionForInspection } from '../../../server/lib/statutory/form-registry';
import { StatutoryFormDeclarationSchema } from '../../../server/lib/validations/statutory-template.schema';
import { refuseUnusableDependencies } from '../../../server/lib/statutory/applicability';
import type {
    StatutoryFieldDependencies,
    StatutoryFormDeclaration,
    StatutoryValueSource,
} from '../../../server/types/statutory-declaration';

/**
 * Florida OIR-B1-1802 Rev. 04/26.
 *
 * -- WHAT THESE ASSERTIONS ARE FOR -------------------------------------------
 * Not the coordinates -- a person signed for those. What is checkable is that
 * the software carries what they signed without alteration, and one thing more
 * that no other published form can check: this is the first revision whose
 * template declaration will carry `dependsOn`, and the schema that guards the
 * catalogue is `.strict()`. Reading that schema and concluding it "should be
 * fine" is the failure this file exists to close, so the declaration is parsed
 * here for real.
 */

/**
 * The five conditional questions, exactly as the signed candidate records them.
 * They are the form's own: question 6's minimal-conditions box exists only for
 * categories B, C and D; question 8 prints its four sealing methods indented
 * under answer A alone, and "entire underside covered" one indent further under
 * spray foam alone, because the other three methods are laid on top of the deck
 * and never touch its underside; question 9 prints the plywood/OSB pair under
 * answer C alone, and its non-glazed sub-levels `A.1`…`N.3` under the letters
 * above them, so the letter has to agree.
 *
 * ⚠️ Question 8 is therefore a CHAIN — the method is gated and also gates —
 * which is the shape `dependency-order.ts` exists for. Declaration order below
 * is deliberately NOT the order the rules must be applied in.
 */
const DEPENDS_ON: StatutoryFieldDependencies = {
    roof_wall_attachment_minimal_condition: {
        field: 'roof_wall_attachment',
        answerIsOneOf: ['B', 'C', 'D'],
    },
    sealed_roof_deck_method: {
        field: 'sealed_roof_deck',
        answerIsOneOf: ['A'],
    },
    sealed_roof_deck_spray_foam_underside_fully_covered: {
        field: 'sealed_roof_deck_method',
        answerIsOneOf: ['spray_foam'],
    },
    opening_protection_wood_panel_type: {
        field: 'opening_protection',
        answerIsOneOf: ['C'],
    },
    opening_protection_non_glazed_level: {
        field: 'opening_protection',
        answerIsOneOf: ['A', 'B', 'C', 'N'],
        labelSeparator: '.',
    },
};

/**
 * A declaration for this form: every field the published map names, bound, plus
 * the three rules above.
 *
 * The bindings are literals because what is under test is the DECLARATION's
 * shape, not where a value comes from — and a declaration built from the
 * published map rather than from a list typed here cannot drift away from the
 * form it claims to produce.
 */
function declarationForThisForm(
    dependsOn: StatutoryFieldDependencies | undefined = DEPENDS_ON,
): StatutoryFormDeclaration {
    const bindings: Record<string, StatutoryValueSource> = {};
    for (const mapping of fieldMap.mappings) {
        bindings[mapping.ourField] = { from: 'literal', value: '' };
    }
    // Named by the rules and not by the map: a controlling question can be one
    // the form asks in prose, and `refuseUnusableDependencies` requires it bound
    // whether or not it prints in a box of its own.
    for (const rule of Object.values(dependsOn ?? {})) {
        bindings[rule.field] ??= { from: 'literal', value: '' };
    }
    return {
        formId: version.formId,
        revision: version.version,
        bindings,
        ...(dependsOn === undefined ? {} : { dependsOn }),
    };
}

describe('FL OIR-B1-1802 Rev. 04/26', () => {
    it('carries the signature of the person who read the form', () => {
        expect(fieldMap.checkedBy).toBe('Nathan');
        expect(fieldMap.checkedAt).toBe(Date.UTC(2026, 7, 30));
    });

    it('pins the revision and its map to ONE set of bytes', () => {
        // This form has a superseded revision (Rev. 01/12) sitting at the more
        // guessable path under the same forms directory. Both open and both look
        // official, so the hash is the only thing that says which is which.
        expect(fieldMap.sourceHash).toBe(version.sourceHash);
        expect(version.sourceHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('names the FORM and not the revision', () => {
        expect(version.formId).toBe('fl_oir_b1_1802');
        expect(version.formId).not.toContain('04');
        expect(version.version).toBe('Rev. 04/26');
    });

    it('carries every mapping the signed candidate carried, and no more', () => {
        expect(fieldMap.mappings).toHaveLength(241);
        const kinds = fieldMap.mappings.reduce<Record<string, number>>((acc, m) => {
            acc[m.kind] = (acc[m.kind] ?? 0) + 1;
            return acc;
        }, {});
        expect(kinds).toEqual({ overlay: 92, checkbox: 149 });
    });

    it('writes a date as one overlay per printed blank', () => {
        // The form prints its own separators: three blanks with slashes in the
        // 2.8pt gaps between them. One overlay across all three writes the year
        // over the wrong blank and leaves the year's own blank empty.
        const parted = fieldMap.mappings.filter((m) => m.kind === 'overlay' && m.part !== undefined);
        expect(parted.length).toBeGreaterThan(0);
        const perField = new Map<string, Set<string>>();
        for (const m of parted) {
            if (m.kind !== 'overlay' || m.part === undefined) continue;
            const seen = perField.get(m.ourField) ?? new Set<string>();
            // Two overlays claiming the same part of one value would draw twice
            // in one blank and leave another empty.
            expect(seen.has(m.part)).toBe(false);
            seen.add(m.part);
            perField.set(m.ourField, seen);
        }
        // Every parted value is written in full: a date missing its year prints
        // as a filled-in form with a blank nobody notices.
        for (const [field, parts] of perField) {
            expect(`${field}: ${[...parts].sort().join('+')}`)
                .toBe(`${field}: date_day+date_month+date_year`);
        }
    });

    it('every overlay that measures its blank measures BOTH bounds', () => {
        const overlays = fieldMap.mappings.filter((m) => m.kind === 'overlay');
        const bothBounds = overlays.filter(
            (m) => m.kind === 'overlay' && m.maxWidth !== undefined && m.maxHeight !== undefined,
        );
        expect(overlays).toHaveLength(92);
        expect(bothBounds).toHaveLength(92);
    });

    it('covers all six pages', () => {
        const pages = new Set<number>();
        for (const m of fieldMap.mappings) {
            if (m.kind === 'acroform' || m.kind === 'acroform_checkbox') continue;
            expect(m.page).toBeGreaterThanOrEqual(0);
            expect(m.page).toBeLessThan(6);
            pages.add(m.page);
        }
        expect([...pages].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
    });

    it('uses the rule\'s own date, with no voluntary window', () => {
        // Rule 69O-170.0155, F.A.C., "Amended ... 3-25-13, 4-1-26". The
        // amendment struck Rev. 01/12 out of the rule text rather than running
        // the two side by side, so there is no window for the older revision.
        expect(version.effectiveFrom).toBe(Date.UTC(2026, 3, 1));
        expect(version.mandatoryFrom).toBe(version.effectiveFrom);
        expect(version.effectiveUntil).toBeNull();
        expect(version.withdrawn).toBeNull();
    });

    it('is listed in the catalogue, and the empty-catalogue reason is gone', () => {
        expect(PUBLISHED_FORM_VERSIONS).toContain(version);
        expect(FIELD_MAPS).toContain(fieldMap);
        expect(EMPTY_CATALOGUE_REASON).toBeNull();
    });

    it('resolves for an inspection dated after the rule took effect', () => {
        const picked = versionForInspection(
            version.formId, Date.UTC(2026, 5, 1), PUBLISHED_FORM_VERSIONS,
        );
        expect(picked?.version).toBe(version.version);
        expect(fieldMapFor(picked!.formId, picked!.version)).toBe(fieldMap);
    });

    it('does NOT resolve for an inspection dated the day before', () => {
        // 2026-03-31 — one day inside the superseded revision's life. A
        // selector that answered this one would hand back the wrong official
        // document for every inspection in the fourteen years before the
        // amendment.
        expect(versionForInspection(
            version.formId, Date.UTC(2026, 2, 31), PUBLISHED_FORM_VERSIONS,
        )).toBeNull();
    });

    it('names its required fields, and each one is actually mapped', () => {
        expect(fieldMap.requiredFields).toHaveLength(20);
        const mapped = new Set(fieldMap.mappings.map((m) => m.ourField));
        for (const f of fieldMap.requiredFields) expect(mapped).toContain(f);
    });

    it('keeps its conditional questions OUT of requiredFields', () => {
        // `requiredFields` means "required of every inspection". A conditional
        // question is not, so a form correctly produced without it would be
        // refused for a key whose absence is the right answer.
        for (const conditional of Object.keys(DEPENDS_ON)) {
            expect(fieldMap.requiredFields).not.toContain(conditional);
        }
    });

    // -- Task: the first real user of `dependsOn` ----------------------------

    it('has its declaration ACCEPTED by the schema that guards the catalogue', () => {
        const parsed = StatutoryFormDeclarationSchema.safeParse(declarationForThisForm());
        // The message, not just the boolean: a `.strict()` refusal names the key
        // it did not recognise, and that is the sentence somebody needs.
        expect(parsed.error?.issues?.[0]?.message ?? 'accepted').toBe('accepted');
        expect(parsed.success).toBe(true);
        // Parsed through, not merely tolerated and dropped.
        const back = parsed.success
            ? (parsed.data as { dependsOn?: Record<string, unknown> }).dependsOn
            : undefined;
        expect(Object.keys(back ?? {}).sort()).toEqual(Object.keys(DEPENDS_ON).sort());
    });

    it('and the schema is still strict — the positive control', () => {
        // Without this, the assertion above is satisfied by a schema that
        // accepts anything, which is exactly what "should be fine" reads like
        // from the outside.
        const madeUp = { ...declarationForThisForm(), totallyMadeUp: 1 };
        expect(StatutoryFormDeclarationSchema.safeParse(madeUp).success).toBe(false);
        // And it still refuses the declaration's own required half.
        const { bindings: _dropped, ...noBindings } = declarationForThisForm();
        expect(StatutoryFormDeclarationSchema.safeParse(noBindings).success).toBe(false);
    });

    it('declares five rules the applicability layer can actually use', () => {
        // Parsing is shape only. This is the layer that decides whether a rule
        // can ever fire: a controlling field nothing binds leaves the question
        // permanently unasked, which prints as a blank box no gate reads. It
        // also refuses a set of rules that gates itself in a ring, which is the
        // one fault a single rule cannot be blamed for.
        expect(() => refuseUnusableDependencies(declarationForThisForm())).not.toThrow();
        expect(Object.keys(DEPENDS_ON)).toHaveLength(5);
    });

    it('and a ring in the same place is refused, naming both questions', () => {
        // The third positive control. `refuseUnusableDependencies` is the only
        // thing standing between a self-gating template and a form nobody can
        // produce, so the check that it refuses one is not optional.
        const ringed: StatutoryFormDeclaration = {
            ...declarationForThisForm(),
            dependsOn: {
                ...DEPENDS_ON,
                sealed_roof_deck_method: {
                    field: 'sealed_roof_deck_spray_foam_underside_fully_covered',
                    answerIsOneOf: ['true'],
                },
            },
        };
        expect(() => refuseUnusableDependencies(ringed))
            .toThrow(/gate each other in a ring/);
    });

    it('and that check is not vacuous either — the second positive control', () => {
        // Built WITHOUT the helper's controller-binding step, which is the
        // whole point: a misspelled controlling field must stay unbound, or the
        // fixture quietly repairs the fault it is meant to demonstrate.
        const broken: StatutoryFormDeclaration = {
            ...declarationForThisForm(undefined),
            dependsOn: {
                roof_wall_attachment_minimal_condition: {
                    field: 'roof_wall_attachment_misspelled',
                    answerIsOneOf: ['B'],
                },
            },
        };
        expect('roof_wall_attachment_misspelled' in broken.bindings).toBe(false);
        expect(() => refuseUnusableDependencies(broken)).toThrow(/binds nothing to that field/);
    });
});
