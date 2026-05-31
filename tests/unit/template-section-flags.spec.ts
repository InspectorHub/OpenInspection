/**
 * Track E2 (Spectora App.A) — per-section disclaimer + always_page_break.
 *
 * Schema-level tests verify that the v2 template Zod validator accepts the
 * new optional fields and rejects malformed ones. The renderer side is
 * exercised by the report-utils + getReportData spec to ensure surfacing
 * those fields onto the report data contract works end-to-end.
 */
import { describe, it, expect } from 'vitest';
import { CreateTemplateSchema } from '../../server/lib/validations/template.schema';

const baseItem = {
    id: 'i1',
    label: 'Item',
    type: 'text' as const,
};

function buildPayload(section: Record<string, unknown>) {
    return {
        name: 'T',
        schema: {
            schemaVersion: 2 as const,
            sections: [{ id: 's1', title: 'Section', items: [baseItem], ...section }],
        },
    };
}

describe('Track E2 — TemplateSectionSchema accepts new flags', () => {
    it('accepts a section with disclaimerText + alwaysPageBreak set', () => {
        const result = CreateTemplateSchema.safeParse(buildPayload({
            disclaimerText: 'Roof not walked due to weather conditions.',
            alwaysPageBreak: true,
        }));
        expect(result.success).toBe(true);
    });

    it('accepts a legacy section without the new fields (backwards compat)', () => {
        const result = CreateTemplateSchema.safeParse(buildPayload({}));
        expect(result.success).toBe(true);
    });

    it('accepts disclaimerText: null (explicit clear)', () => {
        const result = CreateTemplateSchema.safeParse(buildPayload({
            disclaimerText: null,
        }));
        expect(result.success).toBe(true);
    });

    it('rejects disclaimerText longer than 4 KB', () => {
        const tooLong = 'x'.repeat(4001);
        const result = CreateTemplateSchema.safeParse(buildPayload({
            disclaimerText: tooLong,
        }));
        expect(result.success).toBe(false);
    });

    it('rejects alwaysPageBreak as a non-boolean value', () => {
        const result = CreateTemplateSchema.safeParse(buildPayload({
            alwaysPageBreak: 'yes',
        }));
        expect(result.success).toBe(false);
    });
});
