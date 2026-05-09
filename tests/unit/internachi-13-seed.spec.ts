import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { TemplateSchemaV2Schema, CreateTemplateSchema } from '../../src/lib/validations/template.schema';

/**
 * S3-5 — InterNACHI 13-Section Standard template seed.
 *
 * 1. Structural snapshot: 13 sections, every section has a disclaimer, all
 *    items are rich (not free-text) with all three tab buckets present.
 * 2. Round-trip via `CreateTemplateSchema` to mirror what
 *    `templateService.createFromMarketplace` does on import — guards
 *    against the schema tightening (max-length section/item) ever
 *    silently dropping the new template.
 * 3. Schema length tightening: section.title max 50, item.label max 100
 *    are enforced.
 */
describe('S3-5 — InterNACHI 13-Section seed', () => {
    const seedPath = path.resolve(
        __dirname,
        '../../src/data/seed-templates/internachi-13.json'
    );
    const doc = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

    it('has exactly 13 sections covering the InterNACHI standard systems', () => {
        const titles = doc.schema.sections.map((s: { title: string }) => s.title);
        expect(titles).toHaveLength(13);
        // Order matches the InterNACHI 13-section ordering called out in the
        // Spec 4F plan. Asserted explicitly so a future PR can't reorder
        // sections without a deliberate test update.
        expect(titles).toEqual([
            'Inspection Details',
            'Exterior',
            'Roof',
            'Basement, Foundation, Crawlspace & Structure',
            'Heating',
            'Cooling',
            'Plumbing',
            'Electrical',
            'Fireplace',
            'Attic, Insulation & Ventilation',
            'Doors, Windows & Interior',
            'Built-in Appliances',
            'Garage',
        ]);
    });

    it('every section ships with a per-section disclaimer (Sprint 2 polish E2)', () => {
        for (const s of doc.schema.sections) {
            expect(s.disclaimerText, `section ${s.title} missing disclaimerText`).toBeDefined();
            expect(typeof s.disclaimerText).toBe('string');
            expect((s.disclaimerText as string).length).toBeGreaterThan(20);
        }
    });

    it('every item declares all three canned-comment tabs', () => {
        for (const s of doc.schema.sections) {
            for (const item of s.items) {
                expect(item.type, `${s.title} > ${item.label} should be rich`).toBe('rich');
                expect(item.tabs).toBeDefined();
                expect(Array.isArray(item.tabs.information)).toBe(true);
                expect(Array.isArray(item.tabs.limitations)).toBe(true);
                expect(Array.isArray(item.tabs.defects)).toBe(true);
            }
        }
    });

    it('passes the v2 template schema validator', () => {
        const result = TemplateSchemaV2Schema.safeParse(doc.schema);
        if (!result.success) {
            const first = result.error.issues[0];
            throw new Error(
                `internachi-13 failed v2 validation at ${first?.path?.join('.')}: ${first?.message}`
            );
        }
        expect(result.success).toBe(true);
    });

    it('round-trips through CreateTemplateSchema (marketplace import path)', () => {
        // Mirrors what the marketplace import handler does: take the seeded
        // schema as-is, wrap in a `name + schema` payload, and re-validate.
        const result = CreateTemplateSchema.safeParse({
            name: doc.name,
            schema: doc.schema,
        });
        expect(result.success).toBe(true);
    });
});

describe('S3-5 — schema length tightening', () => {
    const baseRichItem = {
        id: 'i1',
        label: 'Item',
        type: 'rich' as const,
        ratingOptions: ['Inspected'],
        tabs: { information: [], limitations: [], defects: [] },
    };

    function build(section: Record<string, unknown>) {
        return {
            name: 'T',
            schema: {
                schemaVersion: 2 as const,
                sections: [{ id: 's1', title: 'OK', items: [baseRichItem], ...section }],
            },
        };
    }

    it('rejects section.title longer than 50 chars', () => {
        const tooLong = 'x'.repeat(51);
        const result = CreateTemplateSchema.safeParse(build({ title: tooLong }));
        expect(result.success).toBe(false);
    });

    it('accepts section.title exactly 50 chars', () => {
        const exact = 'y'.repeat(50);
        const result = CreateTemplateSchema.safeParse(build({ title: exact }));
        expect(result.success).toBe(true);
    });

    it('rejects item.label longer than 100 chars', () => {
        const longLabel = 'z'.repeat(101);
        const payload = build({
            items: [{ ...baseRichItem, label: longLabel }],
        });
        const result = CreateTemplateSchema.safeParse(payload);
        expect(result.success).toBe(false);
    });

    it('accepts item.label exactly 100 chars', () => {
        const exact = 'a'.repeat(100);
        const payload = build({
            items: [{ ...baseRichItem, label: exact }],
        });
        const result = CreateTemplateSchema.safeParse(payload);
        expect(result.success).toBe(true);
    });
});
