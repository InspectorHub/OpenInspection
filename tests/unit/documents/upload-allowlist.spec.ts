import { describe, it, expect } from 'vitest';
import { ALLOWED_EXTENSIONS, CAD_EXTENSIONS, ALLOWED_CONTENT_TYPES, MAX_UPLOAD_BYTES }
    from '../../../server/lib/upload-allowlist';

describe('upload allowlist', () => {
    it('is one list both sides import', () => {
        expect(ALLOWED_EXTENSIONS.has('pdf')).toBe(true);
        expect(ALLOWED_EXTENSIONS.has('exe')).toBe(false);
        expect(CAD_EXTENSIONS.has('dwg')).toBe(true);
        expect(ALLOWED_CONTENT_TYPES.has('application/pdf')).toBe(true);
        expect(MAX_UPLOAD_BYTES).toBe(100 * 1024 * 1024);
    });
});
