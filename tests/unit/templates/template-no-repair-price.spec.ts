/**
 * A template may not declare a repair price.
 *
 * `TemplateItem` carried `defaultEstimateMin` / `defaultEstimateMax`, and an
 * item's `attributes[]` carried `estimateMin` / `estimateMax`. No editor screen
 * ever wrote any of the four and no shipped template contains one — but the
 * template write API accepted them, so a hand-written PUT could put a repair
 * price into a template that every inspection made from it would inherit. A
 * library entry reused across every property cannot know any property's repair
 * cost, which is exactly why the canned-comment columns were dropped; the
 * template item is the same figure one level up.
 *
 * This is the one surface in this family with a request boundary, so the
 * refusal is LOUD: the item schemas are `.strict()`, and a caller that sends
 * the key gets a validation error instead of a silently discarded field. A
 * write that is accepted and then ignored is a contract that still advertises
 * the capability, and leaves "I sent it and nothing happened" with no evidence.
 */
import { describe, it, expect } from 'vitest';
import { CreateTemplateSchema } from '../../../server/lib/validations/template.schema';

const baseItem = { id: 'i1', label: 'Item', type: 'text' as const };

function payload(item: Record<string, unknown>) {
    return {
        name: 'T',
        schema: {
            schemaVersion: 2 as const,
            sections: [{ id: 's1', title: 'Section', items: [item] }],
        },
    };
}

describe('template Zod — no repair price may be authored', () => {
    it('accepts the same item without a price (the control)', () => {
        // Guards the other direction: the rejections below must come from the
        // price key, not from a payload that was malformed all along.
        expect(CreateTemplateSchema.safeParse(payload({ ...baseItem })).success).toBe(true);
    });

    it('rejects an item declaring defaultEstimateMin / defaultEstimateMax', () => {
        const r = CreateTemplateSchema.safeParse(payload({
            ...baseItem,
            defaultEstimateMin: 15000,
            defaultEstimateMax: 40000,
        }));
        expect(r.success).toBe(false);
        // Loud, and it names the offending key — not a generic shape error.
        expect(JSON.stringify(r.error?.issues)).toMatch(/defaultEstimateM(in|ax)/);
    });

    it('rejects an item attribute declaring estimateMin / estimateMax', () => {
        const r = CreateTemplateSchema.safeParse(payload({
            ...baseItem,
            attributes: [
                { id: 'a1', name: 'Tonnage', type: 'number', estimateMin: 15000, estimateMax: 40000 },
            ],
        }));
        expect(r.success).toBe(false);
        expect(JSON.stringify(r.error?.issues)).toMatch(/estimateM(in|ax)/);

        // The same attribute minus the money is fine — the attribute feature is
        // not what is being refused.
        expect(CreateTemplateSchema.safeParse(payload({
            ...baseItem,
            attributes: [{ id: 'a1', name: 'Tonnage', type: 'number' }],
        })).success).toBe(true);
    });

    it('still accepts defaultRecommendation — scope is not a price', () => {
        const r = CreateTemplateSchema.safeParse(payload({
            ...baseItem,
            defaultRecommendation: 'Have a licensed roofer evaluate.',
        }));
        expect(r.success).toBe(true);
    });
});
