import { describe, it, expect } from 'vitest';
import { getLegalLinks, buildTermsAcceptedBlob } from '../../server/lib/legal-links';

describe('legal-links', () => {
    it('returns null when neither URL is configured (feature off)', () => {
        expect(getLegalLinks({})).toBeNull();
        expect(getLegalLinks({ TERMS_URL: '', PRIVACY_URL: '' })).toBeNull();
    });
    it('returns whichever URLs are configured', () => {
        expect(getLegalLinks({ TERMS_URL: 'https://x/terms' }))
            .toEqual({ termsUrl: 'https://x/terms', privacyUrl: undefined });
        expect(getLegalLinks({ TERMS_URL: 'https://x/terms', PRIVACY_URL: 'https://x/privacy' }))
            .toEqual({ termsUrl: 'https://x/terms', privacyUrl: 'https://x/privacy' });
    });
    it('buildTermsAcceptedBlob stamps time + request context', () => {
        const blob = buildTermsAcceptedBlob(
            { termsUrl: 'https://x/terms', privacyUrl: 'https://x/privacy' },
            { ip: '1.2.3.4', country: 'US' },
        );
        expect(blob.termsUrl).toBe('https://x/terms');
        expect(blob.ip).toBe('1.2.3.4');
        expect(blob.country).toBe('US');
        expect(new Date(blob.at).getTime()).toBeGreaterThan(0);
    });
});
