import { describe, it, expect } from 'vitest';
import { selectPrompts, PROMPTS } from '../../../server/lib/mcp/prompts';

describe('selectPrompts', () => {
    it('offers inspection prompts when read:inspections is granted', () => {
        const names = selectPrompts(['read:inspections']).map((p) => p.name).sort();
        expect(names).toEqual(['draft_repair_request', 'review_findings', 'summarize_inspection']);
    });

    it('gates the contacts prompt on read:contacts', () => {
        expect(selectPrompts(['read:inspections']).map((p) => p.name)).not.toContain('client_follow_up_email');
        expect(selectPrompts(['read:contacts']).map((p) => p.name)).toContain('client_follow_up_email');
    });

    it('offers nothing when no relevant scope is granted', () => {
        expect(selectPrompts(['write:invoices'])).toEqual([]);
    });

    it('honors the read:* wildcard', () => {
        expect(selectPrompts(['read:*']).length).toBe(PROMPTS.length);
    });

    it('build() interpolates arguments into the message text', () => {
        const p = PROMPTS.find((x) => x.name === 'summarize_inspection')!;
        const text = p.build({ inspection_id: 'insp-42' });
        expect(text).toContain('insp-42');
        expect(text).toContain('openinspection:///api/inspections/insp-42');
    });

    it('every prompt requires at least one scope (no always-on prompts)', () => {
        for (const p of PROMPTS) expect(p.requires.length).toBeGreaterThan(0);
    });
});
