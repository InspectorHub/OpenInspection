/**
 * The report-data document lists the item types a report item can have. That list is a copy of the template schema's, and a copy that nothing
 * compares drifts: a new item type would be returned by the server and missing from the published contract. This compares them.
 */
import { describe, it, expect } from 'vitest';
import { TemplateItemSchema } from '../../../server/lib/validations/template.schema';
import { REPORT_ITEM_TYPES } from '../../../server/lib/validations/inspection/report-data.schema';

/** The comparison the real assertion uses, as a function, so the control below can run the very same code on a list that differs. */
const sameTypes = (documented: readonly string[], fromTemplate: readonly string[]): boolean => {
    if (documented.length !== fromTemplate.length) return false;
    const sorted = [...documented].sort();
    return [...fromTemplate].sort().every((type, index) => type === sorted[index]);
};

describe('report-data item types', () => {
    const templateTypes = TemplateItemSchema.options.map((option) => option.shape.type.value as string);

    it('are the template schema\'s item types, no more and no fewer', () => {
        // The template side really produced a list (an empty one would make the comparison pass for nothing).
        expect(templateTypes.length).toBeGreaterThanOrEqual(9);
        expect(sameTypes(REPORT_ITEM_TYPES, templateTypes)).toBe(true);
    });

    it('the comparison reports a difference when a type is missing, added or renamed', () => {
        expect(sameTypes(REPORT_ITEM_TYPES.filter((type) => type !== 'date'), templateTypes)).toBe(false);
        expect(sameTypes([...REPORT_ITEM_TYPES, 'signature'], templateTypes)).toBe(false);
        expect(sameTypes(REPORT_ITEM_TYPES.map((type) => (type === 'date' ? 'datetime' : type)), templateTypes)).toBe(false);
    });
});
