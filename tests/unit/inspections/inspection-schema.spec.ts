import { describe, it, expect } from 'vitest';
import { CreateInspectionSchema, GetInspectionResponseSchema } from '../../../server/lib/validations/inspection.schema';

/**
 * iter-1 production bug #1 — `clientEmail` Zod validation rejected an empty
 * string from the New Inspection modal. The dashboard form posts
 * `clientEmail: ""` when the inspector skips the field, and the previous
 * `z.string().email().optional().nullable()` chain ran `.email()` on the
 * empty string and returned `code: invalid_format` with the raw regex.
 *
 * After the fix, the schema accepts:
 *   - a valid email
 *   - an empty string (treated as "skip this field")
 *   - null
 *   - undefined (key omitted entirely)
 *
 * Empty string MUST be normalised to `null` so downstream service code that
 * persists the row sees a single canonical "missing" representation.
 */
describe('CreateInspectionSchema.clientEmail', () => {
    const baseValid = {
        propertyAddress: '123 Main St, Anytown',
        clientName: 'Jane Doe',
        templateId: '550e8400-e29b-41d4-a716-446655440002',
    };

    it('accepts a valid email address', () => {
        const result = CreateInspectionSchema.safeParse({
            ...baseValid,
            clientEmail: 'jane@example.com',
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.clientEmail).toBe('jane@example.com');
        }
    });

    it('accepts an empty string and normalises it to null', () => {
        const result = CreateInspectionSchema.safeParse({
            ...baseValid,
            clientEmail: '',
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.clientEmail).toBeNull();
        }
    });

    it('accepts null', () => {
        const result = CreateInspectionSchema.safeParse({
            ...baseValid,
            clientEmail: null,
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.clientEmail).toBeNull();
        }
    });

    it('accepts undefined (clientEmail key omitted)', () => {
        const result = CreateInspectionSchema.safeParse(baseValid);
        expect(result.success).toBe(true);
    });

    it('rejects a malformed email string', () => {
        const result = CreateInspectionSchema.safeParse({
            ...baseValid,
            clientEmail: 'not-an-email',
        });
        expect(result.success).toBe(false);
        if (!result.success) {
            // Ensure the human-friendly message is preserved (bug #2 fixture).
            const messages = result.error.issues.map((i) => i.message);
            expect(messages.some((m) => /invalid email/i.test(m))).toBe(true);
        }
    });
});

/**
 * GET /api/inspections/{id} returns the whole inspection row, so the cover photo, the property
 * facts and the PCA narrative reach the client. The response schema must declare them: a schema
 * that leaves them out hides fields the editor and the native app read.
 */
describe('GetInspectionResponseSchema declares the editor fields the row carries', () => {
    const inspection = {
        id: 'i1', propertyAddress: '1 Main St', clientName: null, clientEmail: null, status: 'requested', date: '2026-06-01',
        inspectorId: null, templateId: null, createdAt: '2026-06-01T10:00:00.000Z',
    };
    const parse = (extra: Record<string, unknown>) => GetInspectionResponseSchema.parse({
        success: true, data: { inspection: { ...inspection, ...extra }, template: null, primaryReportId: null },
    }).data.inspection as Record<string, unknown>;

    it('keeps coverPhotoId, propertyFacts and pcaNarrative', () => {
        const out = parse({ coverPhotoId: 'k.jpg', propertyFacts: { yearBuilt: 1990 }, pcaNarrative: { purpose: 'p' } });
        expect(out.coverPhotoId).toBe('k.jpg');
        expect(out.propertyFacts).toEqual({ yearBuilt: 1990 });
        expect(out.pcaNarrative).toEqual({ purpose: 'p' });
    });

    it('control: they stay optional, and null is a valid value', () => {
        expect(parse({})).not.toHaveProperty('coverPhotoId');
        const out = parse({ coverPhotoId: null, propertyFacts: null, pcaNarrative: null });
        expect(out).toMatchObject({ coverPhotoId: null, propertyFacts: null, pcaNarrative: null });
    });
});
