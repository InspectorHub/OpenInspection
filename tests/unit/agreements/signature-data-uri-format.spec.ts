/**
 * Which image formats a stored signature may arrive in.
 *
 * The refusal has to happen HERE, at the moment somebody saves a signature in
 * Settings, because the only other place it can happen is the moment an
 * inspector presses send in the field. A format nothing can draw passes this
 * schema, is written to `users.default_signature_base64`, and then surfaces as a
 * failed document at the worst possible time -- or, worse, as a signature box
 * that came out empty.
 */
import { describe, it, expect } from 'vitest';
import {
    InspectorSignSchema,
    UserDefaultSignatureSchema,
} from '../../../server/lib/validations/admin/agreement';

/** A 1x1 PNG, long enough to clear the schema's own length floor. */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwC'
    + 'AAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=';

const JPEG = 'data:image/jpeg;base64,' + 'A'.repeat(64);

/** A perfectly well-formed SVG data URI. pdf-lib cannot draw one. */
const SVG = 'data:image/svg+xml;base64,'
    + 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MDAiIGhlaWdodD0iMTUwIi8+';

/**
 * The one thing both schemas are asked here. Narrowed to `safeParse` on purpose:
 * the two carry different OpenAPI metadata, and a shared assertion should not
 * depend on which of them it was handed.
 */
interface SignatureSchema {
    safeParse(input: unknown): { success: boolean };
}

const SCHEMAS: Array<[string, SignatureSchema]> = [
    ['InspectorSignSchema', InspectorSignSchema],
    ['UserDefaultSignatureSchema', UserDefaultSignatureSchema],
];

for (const [name, schema] of SCHEMAS) {
    describe(name, () => {
        // -- must REFUSE -----------------------------------------------------
        it('refuses an SVG signature, which pdf-lib cannot embed', () => {
            expect(schema.safeParse({ signatureBase64: SVG }).success).toBe(false);
        });

        it('refuses a format nobody declared at all', () => {
            expect(schema.safeParse({
                signatureBase64: 'data:image/webp;base64,' + 'A'.repeat(64),
            }).success).toBe(false);
        });

        // -- must ALLOW (positive controls) ----------------------------------
        // A schema that refused everything would pass the two above and prove
        // nothing about what an inspector can actually save.
        it('accepts a PNG, which is what the signature pad produces', () => {
            expect(schema.safeParse({ signatureBase64: PNG }).success).toBe(true);
        });

        it('accepts a JPEG, which is what a scanned signature usually is', () => {
            expect(schema.safeParse({ signatureBase64: JPEG }).success).toBe(true);
        });
    });
}
