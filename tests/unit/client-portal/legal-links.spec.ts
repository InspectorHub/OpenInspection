import { describe, it, expect } from 'vitest';
import {
    resolveTenantLegalUrls,
    hostedLegalPaths,
    buildTermsAcceptedBlob,
} from '../../../server/lib/legal-links';

describe('resolveTenantLegalUrls', () => {
    it('defaults to hosted paths under base URL', () => {
        expect(resolveTenantLegalUrls('acme', 'https://app.example/', null)).toEqual({
            privacyUrl: 'https://app.example/legal/acme/privacy',
            termsUrl: 'https://app.example/legal/acme/terms',
        });
    });

    it('uses custom URLs when both are set', () => {
        expect(resolveTenantLegalUrls('acme', 'https://app.example', {
            legalMode: 'custom',
            customPrivacyUrl: 'https://acme.com/privacy',
            customTermsUrl: 'https://acme.com/terms',
        })).toEqual({
            privacyUrl: 'https://acme.com/privacy',
            termsUrl: 'https://acme.com/terms',
        });
    });

    it('falls back to hosted when custom mode is missing a URL', () => {
        expect(resolveTenantLegalUrls('acme', 'https://app.example', {
            legalMode: 'custom',
            customPrivacyUrl: 'https://acme.com/privacy',
            customTermsUrl: null,
        })).toEqual({
            privacyUrl: 'https://app.example/legal/acme/privacy',
            termsUrl: 'https://app.example/legal/acme/terms',
        });
    });
});

describe('hostedLegalPaths', () => {
    it('encodes the slug', () => {
        expect(hostedLegalPaths('acme co')).toEqual({
            privacyPath: '/legal/acme%20co/privacy',
            termsPath: '/legal/acme%20co/terms',
        });
    });
});

describe('buildTermsAcceptedBlob', () => {
    it('stamps both URLs', () => {
        const blob = buildTermsAcceptedBlob(
            { termsUrl: 'https://x/terms', privacyUrl: 'https://x/privacy' },
            { ip: '1.1.1.1' },
        );
        expect(blob.termsUrl).toBe('https://x/terms');
        expect(blob.privacyUrl).toBe('https://x/privacy');
        expect(blob.ip).toBe('1.1.1.1');
        expect(blob.at).toMatch(/^\d{4}-/);
    });
});
