/**
 * PCA / multi-unit UI — the v2 template Zod must accept the applicability and
 * property-type fields that already exist in TemplateSchemaV2 (server/types).
 * These were previously rejected because both object schemas are `.strict()`.
 */
import { describe, it, expect } from 'vitest';
import { CreateTemplateSchema } from '../../../server/lib/validations/template.schema';

const baseItem = { id: 'i1', label: 'Item', type: 'text' as const };

function buildPayload(opts: { section?: Record<string, unknown>; top?: Record<string, unknown> } = {}) {
    return {
        name: 'T',
        schema: {
            schemaVersion: 2 as const,
            sections: [{ id: 's1', title: 'Section', items: [baseItem], ...(opts.section ?? {}) }],
            ...(opts.top ?? {}),
        },
    };
}

describe('template Zod — applicability + property-type', () => {
    it('accepts a section with applicableTo (propertyTypes + commercialSubtypes) and defaultScope', () => {
        const r = CreateTemplateSchema.safeParse(buildPayload({
            section: {
                applicableTo: { propertyTypes: ['commercial'], commercialSubtypes: ['office'] },
                defaultScope: 'unit',
            },
        }));
        expect(r.success).toBe(true);
    });

    it('accepts a template with propertyType + commercialSubtype', () => {
        const r = CreateTemplateSchema.safeParse(buildPayload({
            top: { propertyType: 'commercial', commercialSubtype: 'office' },
        }));
        expect(r.success).toBe(true);
    });

    it('accepts a legacy template/section without any of the new fields', () => {
        expect(CreateTemplateSchema.safeParse(buildPayload()).success).toBe(true);
    });

    it('rejects an invalid propertyType value', () => {
        const r = CreateTemplateSchema.safeParse(buildPayload({ top: { propertyType: 'duplex' } }));
        expect(r.success).toBe(false);
    });

    it('rejects an invalid defaultScope value', () => {
        const r = CreateTemplateSchema.safeParse(buildPayload({ section: { defaultScope: 'floor' } }));
        expect(r.success).toBe(false);
    });

    it('rejects an invalid applicableTo.propertyTypes entry', () => {
        const r = CreateTemplateSchema.safeParse(buildPayload({
            section: { applicableTo: { propertyTypes: ['warehouse'] } },
        }));
        expect(r.success).toBe(false);
    });
});
