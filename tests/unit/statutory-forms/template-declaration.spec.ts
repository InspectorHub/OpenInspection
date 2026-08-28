/**
 * A template may declare that it produces an authority's own form.
 *
 * The declaration names the FORM, never a revision — which revision applies is
 * decided by the inspection date, elsewhere. Binding a revision here would make
 * every template carrying one go stale the moment the authority republishes,
 * and would put the choice in the hands of whoever last edited the template
 * rather than in the date the inspection happened.
 */
import { describe, it, expect } from 'vitest';
import type { TemplateSchemaV2 } from '../../../server/types/template-schema';

describe('a template declares the statutory form it produces', () => {
    it('a declaration names a form and binds every value to a source', () => {
        const t: TemplateSchemaV2 = {
            schemaVersion: 2,
            sections: [],
            statutoryForm: {
                formId: 'tx_trec_rei',
                bindings: {
                    'client.name': { from: 'inspection', field: 'client_name' },
                    'roof.covering': { from: 'item', itemId: 'itm_roof_cov' },
                },
            },
        };
        expect(t.statutoryForm?.formId).toBe('tx_trec_rei');
        expect(t.statutoryForm?.bindings['client.name']).toEqual({
            from: 'inspection', field: 'client_name',
        });
    });

    it('POSITIVE CONTROL — a template without one is still a valid v2 template', () => {
        // Otherwise the type change above passes for a version that made the key
        // required, which would invalidate every template already stored.
        const t: TemplateSchemaV2 = { schemaVersion: 2, sections: [] };
        expect(t.statutoryForm).toBeUndefined();
    });

    it('every binding source is one of the four, and `from` discriminates', () => {
        // The union is closed on purpose. An open `from: string` would defer a
        // typo to runtime, where its whole output is a blank box on somebody's
        // statutory form — a failure that looks like an inspector's omission.
        const t: TemplateSchemaV2 = {
            schemaVersion: 2,
            sections: [],
            statutoryForm: {
                formId: 'tx_trec_rei',
                bindings: {
                    a: { from: 'item', itemId: 'itm_a' },
                    b: { from: 'item_attribute', itemId: 'itm_b', attribute: 'material' },
                    c: { from: 'inspection', field: 'inspection_date' },
                    d: { from: 'literal', value: 'N/A' },
                },
            },
        };
        const kinds = Object.values(t.statutoryForm!.bindings).map((b) => b.from).sort();
        expect(kinds).toEqual(['inspection', 'item', 'item_attribute', 'literal']);
    });
});
