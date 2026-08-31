/**
 * A question gated on a question that is itself gated.
 *
 * The 1802's question 8 is printed three levels deep — the deck is sealed, it
 * was sealed by one of four methods, and one of those four has a box under it —
 * so the rules can no longer be judged in the order somebody typed them. Every
 * assertion here is therefore run against EVERY declaration order of the same
 * rules: an implementation that happens to be right for the order used to write
 * the test is exactly the implementation this file exists to catch.
 *
 * ⚠️ And the assertions are on `collectStatutoryValues`, not on the collector's
 * pieces. `applyDependencies` is the only thing that removes a key, and the
 * removal is what a wrong order gets wrong — an ordering test that only compared
 * two lists of names would pass on an implementation that computed a fine order
 * and then ignored it.
 */
import { describe, it, expect } from 'vitest';
import { dependencyOrder } from '../../../server/lib/statutory/dependency-order';
import { collectStatutoryValues } from '../../../server/lib/statutory/values';
import type { StatutoryValue } from '../../../server/lib/statutory/field-map';
import type {
    StatutoryFieldDependencies,
    StatutoryFormDeclaration,
    TemplateSchemaV2,
} from '../../../server/types/template-schema';

const SNAPSHOT = {
    schemaVersion: 2,
    sections: [{
        id: 'sec_roof',
        title: 'Roof',
        items: [
            { id: 'itm_sealed', label: 'Sealed roof deck', type: 'select' },
            { id: 'itm_method', label: 'Sealing method', type: 'select' },
            { id: 'itm_underside', label: 'Underside covered', type: 'select' },
            { id: 'itm_fourth', label: 'A fourth level', type: 'select' },
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
 * The 1802's question 8, reduced to the shape this file is about.
 *
 * `sealed_roof_deck` is asked of every inspection. Its four methods are printed
 * indented under answer A alone, and "check here if entire roof deck underside
 * covered" is printed one indent further, under spray foam alone — the other
 * three methods are laid ON TOP of the deck and never touch its underside.
 */
const SEALED_DECK: StatutoryFieldDependencies = {
    sealed_roof_deck_method: {
        field: 'sealed_roof_deck',
        answerIsOneOf: ['A'],
    },
    sealed_roof_deck_spray_foam_underside_fully_covered: {
        field: 'sealed_roof_deck_method',
        answerIsOneOf: ['spray_foam'],
    },
};

/** Every ordering of one rule set, as separate objects. */
function everyDeclarationOrder(
    rules: StatutoryFieldDependencies,
): StatutoryFieldDependencies[] {
    const names = Object.keys(rules);
    const orders: string[][] = [[]];
    for (let i = 0; i < names.length; i++) {
        const grown: string[][] = [];
        for (const order of orders) {
            for (const name of names) {
                if (!order.includes(name)) grown.push([...order, name]);
            }
        }
        orders.length = 0;
        orders.push(...grown);
    }
    return orders.map((order) => {
        const rebuilt: Record<string, StatutoryFieldDependencies[string]> = {};
        for (const name of order) rebuilt[name] = rules[name];
        return rebuilt;
    });
}

function declarationWith(
    dependsOn: StatutoryFieldDependencies,
    extraBindings: readonly string[] = [],
): StatutoryFormDeclaration {
    const bindings: StatutoryFormDeclaration['bindings'] = {
        sealed_roof_deck: { from: 'item', itemId: 'itm_sealed' },
        sealed_roof_deck_method: { from: 'item', itemId: 'itm_method' },
        sealed_roof_deck_spray_foam_underside_fully_covered:
            { from: 'item', itemId: 'itm_underside' },
    };
    for (const name of extraBindings) bindings[name] = { from: 'item', itemId: 'itm_fourth' };
    return { formId: 'fl_oir_b1_1802', bindings, dependsOn };
}

function collect(
    dependsOn: StatutoryFieldDependencies,
    answers: Record<string, string>,
    extraBindings: readonly string[] = [],
): Record<string, StatutoryValue> {
    const results: Record<string, { value: string }> = {
        itm_sealed: { value: answers.sealed_roof_deck ?? '' },
        itm_method: { value: answers.sealed_roof_deck_method ?? '' },
        itm_underside: { value: answers.underside ?? '' },
        itm_fourth: { value: answers.fourth ?? '' },
    };
    return collectStatutoryValues(
        declarationWith(dependsOn, extraBindings),
        SNAPSHOT,
        results,
        FACTS,
    );
}

describe('dependencyOrder puts a controller before the question it controls', () => {
    it('does so whichever order the template declares the two rules in', () => {
        const orders = everyDeclarationOrder(SEALED_DECK);
        expect(orders).toHaveLength(2);
        for (const rules of orders) {
            const order = dependencyOrder(rules);
            expect(order.indexOf('sealed_roof_deck_method'))
                .toBeLessThan(order.indexOf('sealed_roof_deck_spray_foam_underside_fully_covered'));
        }
    });

    it('CONTROL — declaration order really does differ between the two', () => {
        // Without this, the assertion above is satisfied by an implementation
        // that returns `Object.keys` unchanged and was handed the lucky order.
        const [first, second] = everyDeclarationOrder(SEALED_DECK).map(Object.keys);
        expect(first).not.toEqual(second);
    });

    it('holds at four levels, in all 24 declaration orders', () => {
        // Four, because a "run the passes twice" fix is right at two levels and
        // silently wrong below that. The fourth level is synthetic; nothing on
        // any measured form goes that deep, and the point is that the ordering
        // does not care how deep it goes.
        const deep: StatutoryFieldDependencies = {
            ...SEALED_DECK,
            fourth_level: {
                field: 'sealed_roof_deck_spray_foam_underside_fully_covered',
                answerIsOneOf: ['true'],
            },
            fifth_level: { field: 'fourth_level', answerIsOneOf: ['true'] },
        };
        const orders = everyDeclarationOrder(deep);
        expect(orders).toHaveLength(24);
        for (const rules of orders) {
            const order = dependencyOrder(rules);
            expect(order).toEqual([
                'sealed_roof_deck_method',
                'sealed_roof_deck_spray_foam_underside_fully_covered',
                'fourth_level',
                'fifth_level',
            ]);
        }
    });

    it('leaves rules at the same depth in the order the template declares them', () => {
        // Two questions off the same controller have no ordering between them,
        // so the template's own order is kept -- a refusal then names the same
        // first offender on every run.
        const siblings: StatutoryFieldDependencies = {
            b_second: { field: 'sealed_roof_deck', answerIsOneOf: ['A'] },
            a_first: { field: 'sealed_roof_deck', answerIsOneOf: ['A'] },
        };
        expect(dependencyOrder(siblings)).toEqual(['b_second', 'a_first']);
    });
});

describe('rules that gate each other in a ring are refused by name', () => {
    it('names both questions in a two-rule ring', () => {
        const ring: StatutoryFieldDependencies = {
            first: { field: 'second', answerIsOneOf: ['x'] },
            second: { field: 'first', answerIsOneOf: ['y'] },
        };
        expect(() => dependencyOrder(ring)).toThrow(/"first" applies only for certain answers to "second"/);
        expect(() => dependencyOrder(ring)).toThrow(/"second" applies only for certain answers to "first"/);
    });

    it('names all three in a three-rule ring, and nothing outside it', () => {
        const ring: StatutoryFieldDependencies = {
            outside: { field: 'sealed_roof_deck', answerIsOneOf: ['A'] },
            one: { field: 'two', answerIsOneOf: ['x'] },
            two: { field: 'three', answerIsOneOf: ['x'] },
            three: { field: 'one', answerIsOneOf: ['x'] },
        };
        let message = '';
        try {
            dependencyOrder(ring);
        } catch (error) {
            message = (error as Error).message;
        }
        expect(message).toContain('"one"');
        expect(message).toContain('"two"');
        expect(message).toContain('"three"');
        expect(message).not.toContain('"outside"');
    });

    it('names a ring reached from OUTSIDE it, and not the rule that led there', () => {
        // The walk starts at `approach`, which is not in the ring. A message
        // that printed the whole walk would blame a rule that is fine.
        const ring: StatutoryFieldDependencies = {
            approach: { field: 'one', answerIsOneOf: ['x'] },
            one: { field: 'two', answerIsOneOf: ['x'] },
            two: { field: 'one', answerIsOneOf: ['x'] },
        };
        let message = '';
        try {
            dependencyOrder(ring);
        } catch (error) {
            message = (error as Error).message;
        }
        expect(message).toContain('"one"');
        expect(message).toContain('"two"');
        expect(message).not.toContain('"approach"');
    });

    it('POSITIVE CONTROL — the same rules without the closing link do not refuse', () => {
        const chain: StatutoryFieldDependencies = {
            one: { field: 'two', answerIsOneOf: ['x'] },
            two: { field: 'sealed_roof_deck', answerIsOneOf: ['A'] },
        };
        expect(() => dependencyOrder(chain)).not.toThrow();
        expect(dependencyOrder(chain)).toEqual(['two', 'one']);
    });
});

describe('a chain, applied to real answers, in every declaration order', () => {
    it('blames the link nearest the TOP of the chain, in every declaration order', () => {
        // The observable difference the order buys, and the reason it is worth
        // having. This inspection says the deck is not sealed (B) and also
        // records a method of sealing it. Two rules have something to say: the
        // method was not asked, and neither was the underside box below it.
        //
        // Judged deepest-rule-first, the underside box is reached while the
        // method is still in the values object, finds "taped_deck_seams" where
        // it wanted spray foam, and refuses in its OWN name -- sending the
        // inspector to a box that is not where the contradiction is. Controllers
        // first, the method is judged against the deck answer and the message
        // names the two boxes that actually disagree.
        for (const rules of everyDeclarationOrder(SEALED_DECK)) {
            let message = '';
            try {
                collect(rules, {
                    sealed_roof_deck: 'B',
                    sealed_roof_deck_method: 'taped_deck_seams',
                    underside: 'true',
                });
            } catch (error) {
                message = (error as Error).message;
            }
            expect(message).toContain('"sealed_roof_deck_method" is answered "taped_deck_seams"');
            expect(message).toContain('only asks it when "sealed_roof_deck"');
            expect(message).not.toContain('"sealed_roof_deck_spray_foam_underside_fully_covered"');
        }
    });

    it('an unanswered chain under an unsealed deck loses both keys in every order', () => {
        for (const rules of everyDeclarationOrder(SEALED_DECK)) {
            const values = collect(rules, {
                sealed_roof_deck: 'B',
                sealed_roof_deck_method: '',
                underside: '',
            });
            expect(Object.keys(values)).not.toContain('sealed_roof_deck_method');
            expect(Object.keys(values))
                .not.toContain('sealed_roof_deck_spray_foam_underside_fully_covered');
            // The controlling question the form DID ask keeps its answer.
            expect(values.sealed_roof_deck).toBe('B');
        }
    });

    it('POSITIVE CONTROL — sealed with spray foam asks both, so both keys are there', () => {
        for (const rules of everyDeclarationOrder(SEALED_DECK)) {
            const values = collect(rules, {
                sealed_roof_deck: 'A',
                sealed_roof_deck_method: 'spray_foam',
                underside: 'true',
            });
            expect(values.sealed_roof_deck_method).toBe('spray_foam');
            expect(values.sealed_roof_deck_spray_foam_underside_fully_covered).toBe('true');
        }
    });

    it('POSITIVE CONTROL — sealed by a method laid on top of the deck asks neither', () => {
        for (const rules of everyDeclarationOrder(SEALED_DECK)) {
            const values = collect(rules, {
                sealed_roof_deck: 'A',
                sealed_roof_deck_method: 'taped_deck_seams',
                underside: '',
            });
            expect(values.sealed_roof_deck_method).toBe('taped_deck_seams');
            expect(Object.keys(values))
                .not.toContain('sealed_roof_deck_spray_foam_underside_fully_covered');
        }
    });

    it('every declaration order produces the SAME outcome, refusals included', () => {
        // The property the ordering exists to give: what the form carries, or
        // what it says when it refuses, is a fact about the INSPECTION and not
        // about the order somebody happened to type the rules in.
        const answerSets = [
            { sealed_roof_deck: 'A', sealed_roof_deck_method: 'spray_foam', underside: 'true' },
            { sealed_roof_deck: 'A', sealed_roof_deck_method: 'spray_foam', underside: '' },
            { sealed_roof_deck: 'A', sealed_roof_deck_method: 'taped_deck_seams', underside: '' },
            { sealed_roof_deck: 'A', sealed_roof_deck_method: '', underside: '' },
            { sealed_roof_deck: 'B', sealed_roof_deck_method: '', underside: '' },
            { sealed_roof_deck: 'B', sealed_roof_deck_method: 'taped_deck_seams', underside: 'true' },
            { sealed_roof_deck: 'B', sealed_roof_deck_method: 'spray_foam', underside: 'true' },
            { sealed_roof_deck: 'C', sealed_roof_deck_method: 'spray_foam', underside: '' },
            { sealed_roof_deck: '', sealed_roof_deck_method: '', underside: 'true' },
        ];
        const outcome = (rules: StatutoryFieldDependencies, answers: Record<string, string>) => {
            try {
                return JSON.stringify(collect(rules, answers));
            } catch (error) {
                return `refused: ${(error as Error).message}`;
            }
        };
        for (const answers of answerSets) {
            const [reference, ...rest] = everyDeclarationOrder(SEALED_DECK)
                .map((rules) => outcome(rules, answers));
            for (const seen of rest) expect(seen, JSON.stringify(answers)).toEqual(reference);
        }
    });

    it('a ring is refused before any answer is read', () => {
        // `refuseUnusableDependencies` runs first in the collector, so a
        // template that gates itself is refused for every inspection rather than
        // for the one that happened to reach it.
        const ring: StatutoryFieldDependencies = {
            sealed_roof_deck_method: {
                field: 'sealed_roof_deck_spray_foam_underside_fully_covered',
                answerIsOneOf: ['true'],
            },
            sealed_roof_deck_spray_foam_underside_fully_covered: {
                field: 'sealed_roof_deck_method',
                answerIsOneOf: ['spray_foam'],
            },
        };
        expect(() => collect(ring, {})).toThrow(/gate each other in a ring/);
    });
});
