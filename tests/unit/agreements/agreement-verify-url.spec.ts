import { describe, it, expect } from 'vitest';
import { envelopeVerifyPath, envelopeVerifyUrl } from '../../../server/lib/agreement-verify-url';

// IA-46 — the verify link delivered to signers must point at the human-readable
// /verify/:envelopeId page, never the /api/public/verify JSON surface. Both the
// confirmation email and the completion-workflow email mint it; this helper is
// the single source so the two can't drift.
describe('envelopeVerifyUrl (IA-46)', () => {
    it('builds the page path, not the JSON API path', () => {
        expect(envelopeVerifyPath('abc')).toBe('/verify/abc');
        expect(envelopeVerifyPath('abc')).not.toContain('/api/');
    });

    it('joins a base URL and strips a trailing slash', () => {
        expect(envelopeVerifyUrl('https://acme.example.com', 'env-1')).toBe('https://acme.example.com/verify/env-1');
        expect(envelopeVerifyUrl('https://acme.example.com/', 'env-1')).toBe('https://acme.example.com/verify/env-1');
    });

    it('falls back to the relative path when no base is resolvable', () => {
        expect(envelopeVerifyUrl('', 'env-1')).toBe('/verify/env-1');
        expect(envelopeVerifyUrl(null, 'env-1')).toBe('/verify/env-1');
        expect(envelopeVerifyUrl(undefined, 'env-1')).toBe('/verify/env-1');
    });
});
