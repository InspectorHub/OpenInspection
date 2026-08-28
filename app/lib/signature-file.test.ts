// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { validateSignatureFile } from '~/lib/image-upload';

const file = (type: string) => new File(['x'], 'sig', { type });

/**
 * A signature is embedded into a PDF, and pdf-lib embeds PNG and JPEG only.
 * The picker used to offer SVG and WebP -- one the server never accepted, the
 * other it accepted and nothing could draw.
 */
describe('validateSignatureFile', () => {
    it('refuses SVG, and says why rather than just refusing', () => {
        const reason = validateSignatureFile(file('image/svg+xml'));
        expect(reason).toBeTruthy();
        expect(String(reason)).toMatch(/PNG|JPEG/i);
    });

    it('refuses WebP, which the server never accepted either', () => {
        expect(validateSignatureFile(file('image/webp'))).toBeTruthy();
    });

    it('accepts PNG and JPEG', () => {
        expect(validateSignatureFile(file('image/png'))).toBeNull();
        expect(validateSignatureFile(file('image/jpeg'))).toBeNull();
    });

    it('still refuses a file that is too large', () => {
        const big = new File([new Uint8Array(3_000_000)], 'sig', { type: 'image/png' });
        expect(validateSignatureFile(big)).toBeTruthy();
    });
});
