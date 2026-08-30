/**
 * A question the form never asked, and a question asked and left blank, are
 * different facts — and on the finished page they are the same blank.
 *
 * Every assertion here is paired with the case that would satisfy it WRONGLY.
 * "A not-applicable field emits no key" is passed by a collector that emits
 * nothing at all, so it is never asserted without "an applicable field that
 * nobody answered emits an EMPTY key" beside it. The same discipline applies to
 * each refusal: a refusal nobody can make fire is indistinguishable from an
 * implementation that refuses everything.
 */
import { describe, it, expect } from 'vitest';
import { collectStatutoryValues } from '../../../server/lib/statutory/values';
import type { StatutoryValue } from '../../../server/lib/statutory/field-map';
import type {
    StatutoryFormDeclaration,
    TemplateSchemaV2,
} from '../../../server/types/template-schema';

const SNAPSHOT = {
    schemaVersion: 2,
    sections: [{
        id: 'sec_roof',
        title: 'Roof',
        items: [
            { id: 'itm_attachment', label: 'Roof to wall attachment', type: 'select' },
            { id: 'itm_minimal', label: 'Minimal conditions', type: 'select' },
            { id: 'itm_sealed_method', label: 'Sealing method', type: 'select' },
            { id: 'itm_underside', label: 'Underside covered', type: 'boolean' },
            { id: 'itm_comments', label: 'Comments', type: 'textarea' },
        ],
    }],
} as unknown as TemplateSchemaV2;

const FACTS = {
    client_name: null,
    client_email: null,
    client_phone: null,
    property_address: null,
    property_city: null,
    property_state: null,
    property_zip: null,
    inspection_date: null,
    inspector_name: null,
    inspector_license: null,
    company_name: null,
    company_phone: null,
    inspector_license_type: null,
    inspector_qualification: null,
    inspector_signature_date: null,
    owner_name: null,
    owner_email: null,
    owner_mailing_address: null,
    owner_home_phone: null,
    owner_work_phone: null,
    owner_cell_phone: null,
    employee_printed_name: null,
};

/**
 * The 1802's question 6, reduced to what this file is about: the three
 * minimal-condition boxes are printed under the sentence "Minimal conditions to
 * qualify for categories B, C, or D", so they exist for exactly those three
 * answers and for none of the other six letters.
 */
function attachmentDecl(): StatutoryFormDeclaration {
    return {
        formId: 'fl_oir_b1_1802',
        bindings: {
            roof_wall_attachment: { from: 'item', itemId: 'itm_attachment' },
            roof_wall_attachment_minimal_condition: { from: 'item', itemId: 'itm_minimal' },
        },
        dependsOn: {
            roof_wall_attachment_minimal_condition: {
                field: 'roof_wall_attachment',
                answerIsOneOf: ['B', 'C', 'D'],
            },
        },
    };
}

function collect(
    declaration: StatutoryFormDeclaration,
    answers: Record<string, string>,
): Record<string, StatutoryValue> {
    const results = Object.fromEntries(
        Object.entries(answers).map(([itemId, value]) => [itemId, { value }]),
    );
    return collectStatutoryValues(declaration, SNAPSHOT, results, FACTS);
}

function has(values: Record<string, StatutoryValue>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(values, key);
}

describe('a question the form did not ask emits no key', () => {
    it('answer A to question 6 leaves the minimal-condition field out entirely', () => {
        // "Minimal conditions to qualify for categories B, C, or D" — A is
        // Toenails, and the three boxes are not printed under it.
        const values = collect(attachmentDecl(), { itm_attachment: 'A' });
        expect(has(values, 'roof_wall_attachment_minimal_condition')).toBe(false);
    });

    it('POSITIVE CONTROL — answer D asks the question, so the key IS there, empty', () => {
        // Without this, an implementation that emitted nothing for anything
        // would pass the assertion above. An empty string here is the whole
        // point: the form asked, and this inspector has not answered yet.
        const values = collect(attachmentDecl(), { itm_attachment: 'D' });
        expect(has(values, 'roof_wall_attachment_minimal_condition')).toBe(true);
        expect(values.roof_wall_attachment_minimal_condition).toBe('');
    });

    it('POSITIVE CONTROL — answer D with an answer below carries that answer', () => {
        // And without THIS, an implementation that emitted '' for every
        // applicable field would pass both of the above.
        const values = collect(attachmentDecl(), { itm_attachment: 'D', itm_minimal: '2' });
        expect(values.roof_wall_attachment_minimal_condition).toBe('2');
    });

    it('the controlling field itself is untouched either way', () => {
        // A rule that removed its own controlling field would satisfy every
        // absence assertion above and lose question 6 off the form.
        expect(collect(attachmentDecl(), { itm_attachment: 'A' }).roof_wall_attachment).toBe('A');
        expect(collect(attachmentDecl(), { itm_attachment: 'D' }).roof_wall_attachment).toBe('D');
    });

    it('an unanswered controlling field means the form has not asked yet', () => {
        // Not a refusal: an inspection nobody has reached question 6 on is not a
        // broken template. The key is absent because nothing has asked for it.
        const values = collect(attachmentDecl(), {});
        expect(has(values, 'roof_wall_attachment')).toBe(true);
        expect(has(values, 'roof_wall_attachment_minimal_condition')).toBe(false);
    });
});

describe('an answer to a question the form did not ask REFUSES', () => {
    it('names both fields and both answers', () => {
        // The alternative is dropping it, which is right about the page and
        // wrong about the inspection: somebody recorded an observation and
        // nobody would ever be told the two answers disagree.
        expect(() => collect(attachmentDecl(), { itm_attachment: 'A', itm_minimal: '2' }))
            .toThrow(/roof_wall_attachment_minimal_condition.*"2".*roof_wall_attachment.*"A"/s);
    });

    it('POSITIVE CONTROL — the same answer under B does not refuse', () => {
        // Without this the refusal above is satisfied by an implementation that
        // refuses every answer to a dependent field.
        expect(() => collect(attachmentDecl(), { itm_attachment: 'B', itm_minimal: '2' }))
            .not.toThrow();
    });

    it('POSITIVE CONTROL — an EMPTY answer under A does not refuse', () => {
        // Opening the item and leaving it alone contradicts nothing, and
        // refusing it would make a form unproducible over a blank.
        const values = collect(attachmentDecl(), { itm_attachment: 'A', itm_minimal: '' });
        expect(has(values, 'roof_wall_attachment_minimal_condition')).toBe(false);
    });
});

describe('the question applies and the template binds nothing to it', () => {
    /** The same form, with the conditional question's binding removed. */
    const unbound: StatutoryFormDeclaration = {
        formId: 'fl_oir_b1_1802',
        bindings: { roof_wall_attachment: { from: 'item', itemId: 'itm_attachment' } },
        dependsOn: {
            roof_wall_attachment_minimal_condition: {
                field: 'roof_wall_attachment',
                answerIsOneOf: ['B', 'C', 'D'],
            },
        },
    };

    it('REFUSES, naming the answer that asked the question', () => {
        // This is where a conditional question's REQUIREMENT lives. The field
        // map's requiredFields cannot carry it — that list means "required of
        // every inspection", and this one is not.
        expect(() => collect(unbound, { itm_attachment: 'C' }))
            .toThrow(/roof_wall_attachment_minimal_condition.*"C"/s);
    });

    it('POSITIVE CONTROL — under A the same template produces the form', () => {
        // A form produced for an inspection the question was never asked of is
        // CORRECT with the key missing. Refusing here would be the failure this
        // rule exists to avoid, arriving from the other direction.
        expect(() => collect(unbound, { itm_attachment: 'A' })).not.toThrow();
    });
});

describe('a sub-level labelled with another answer’s letter REFUSES', () => {
    /**
     * The 1802's question 9. Its twelve non-glazed sub-levels print as A.1…N.3
     * in one continuous run of boxes under the six letters above them, so the
     * letter in the sub-level is which line of the page it is.
     */
    const decl: StatutoryFormDeclaration = {
        formId: 'fl_oir_b1_1802',
        bindings: {
            opening_protection: { from: 'item', itemId: 'itm_attachment' },
            opening_protection_non_glazed_level: { from: 'item', itemId: 'itm_minimal' },
        },
        dependsOn: {
            opening_protection_non_glazed_level: {
                field: 'opening_protection',
                answerIsOneOf: ['A', 'B', 'C', 'N'],
                labelSeparator: '.',
            },
        },
    };

    it('A above and C.2 below is refused, and the message names both boxes', () => {
        expect(() => collect(decl, { itm_attachment: 'A', itm_minimal: 'C.2' }))
            .toThrow(/opening_protection.*"A".*opening_protection_non_glazed_level.*"C\.2"/s);
    });

    it('POSITIVE CONTROL — A above and A.2 below passes', () => {
        // Without this, "refuses a mismatch" is satisfied by refusing every
        // sub-level ever chosen.
        expect(collect(decl, { itm_attachment: 'A', itm_minimal: 'A.2' })
            .opening_protection_non_glazed_level).toBe('A.2');
    });

    it('POSITIVE CONTROL — a letter that only PREFIXES the other is still refused', () => {
        // `startsWith` on the letter alone would accept N.1 under an answer of
        // N and also accept it under an answer of "N.1" itself. The separator is
        // part of the comparison for that reason.
        expect(() => collect(decl, { itm_attachment: 'B', itm_minimal: 'BB.1' })).toThrow();
        expect(collect(decl, { itm_attachment: 'B', itm_minimal: 'B.1' })
            .opening_protection_non_glazed_level).toBe('B.1');
    });

    it('X has no sub-level printed under it at all, so the field is not asked', () => {
        const values = collect(decl, { itm_attachment: 'X' });
        expect(has(values, 'opening_protection_non_glazed_level')).toBe(false);
    });

    it('POSITIVE CONTROL — an unanswered sub-level under A is allowed', () => {
        // Empty is an answer of nothing to a question that WAS asked, and the
        // label rule has nothing to compare.
        expect(collect(decl, { itm_attachment: 'A', itm_minimal: '' })
            .opening_protection_non_glazed_level).toBe('');
    });
});

describe('a dependency that could never work is refused before any answer is read', () => {
    function withRule(rule: Record<string, unknown>): StatutoryFormDeclaration {
        return {
            ...attachmentDecl(),
            dependsOn: { roof_wall_attachment_minimal_condition: rule },
        } as unknown as StatutoryFormDeclaration;
    }

    it('a question gated on ITSELF', () => {
        expect(() => collect(
            withRule({ field: 'roof_wall_attachment_minimal_condition', answerIsOneOf: ['B'] }),
            { itm_attachment: 'B' },
        )).toThrow(/itself/);
    });

    it('a rule that applies for no answer at all', () => {
        expect(() => collect(
            withRule({ field: 'roof_wall_attachment', answerIsOneOf: [] }),
            { itm_attachment: 'B' },
        )).toThrow(/never ask it/);
    });

    it('a controlling field this template binds nothing to', () => {
        // The commonest typo. Left alone it makes the question silently never
        // apply, and the entire observable output is one unticked box.
        expect(() => collect(
            withRule({ field: 'roof_wall_attachmnet', answerIsOneOf: ['B'] }),
            { itm_attachment: 'B' },
        )).toThrow(/roof_wall_attachmnet/);
    });

    it('POSITIVE CONTROL — the well-formed rule beside them does not refuse', () => {
        expect(() => collect(attachmentDecl(), { itm_attachment: 'B' })).not.toThrow();
    });

    it('refuses on the SHAPE even for an inspection the rule would not apply to', () => {
        // A template broken for every inspection must not look healthy on the
        // ones that happen not to reach the question.
        expect(() => collect(
            withRule({ field: 'roof_wall_attachmnet', answerIsOneOf: ['B'] }),
            {},
        )).toThrow(/roof_wall_attachmnet/);
    });
});

describe('a repeated block may not overflow into a conditional field', () => {
    const group = {
        id: 'panel',
        label: 'Electrical Panel',
        capacity: 1,
        slotLabels: ['Main Panel'],
        fields: ['total_amps'],
        overflowTo: 'form_comments',
    };

    function withDestination(conditional: boolean): StatutoryFormDeclaration {
        return {
            formId: 'fl_oir_b1_1802',
            bindings: {
                roof_wall_attachment: { from: 'item', itemId: 'itm_attachment' },
                form_comments: { from: 'item', itemId: 'itm_comments' },
            },
            groups: [group],
            ...(conditional
                ? {
                    dependsOn: {
                        form_comments: { field: 'roof_wall_attachment', answerIsOneOf: ['B'] },
                    },
                }
                : {}),
        };
    }

    it('REFUSES, because on every other answer the extra instance has nowhere to go', () => {
        expect(() => collect(withDestination(true), { itm_attachment: 'B' }))
            .toThrow(/form_comments/);
    });

    it('POSITIVE CONTROL — an unconditional destination is accepted', () => {
        expect(() => collect(withDestination(false), { itm_attachment: 'B' })).not.toThrow();
    });
});
