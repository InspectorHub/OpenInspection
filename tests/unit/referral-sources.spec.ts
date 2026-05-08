/**
 * Round-2 backlog G3 (Spectora §4.1, ITB UC-ITB-10) — referral source list
 * resolver. Asserts:
 *   - Seed list is always returned.
 *   - Custom labels are appended in order.
 *   - Empty / whitespace entries are dropped.
 *   - Case-insensitive de-duplication against seed + earlier custom values.
 */

import { describe, it, expect } from 'vitest';
import { SEED_REFERRAL_SOURCES, resolveReferralSources } from '../../src/lib/referral-sources';
import { UpdateBrandingSchema } from '../../src/lib/validations/admin.schema';

describe('resolveReferralSources', () => {
    it('returns the seven seed values when no custom list', () => {
        const out = resolveReferralSources();
        expect(out).toEqual([...SEED_REFERRAL_SOURCES]);
        // Sanity: list contains the canonical seven labels.
        expect(out).toContain('Realtor');
        expect(out).toContain('Past Client');
        expect(out).toContain('Google Search');
        expect(out).toContain('Facebook');
        expect(out).toContain('Yelp');
        expect(out).toContain('Walk-in');
        expect(out).toContain('Other');
        expect(out).toHaveLength(7);
    });

    it('handles null / undefined gracefully', () => {
        expect(resolveReferralSources(null)).toHaveLength(7);
        expect(resolveReferralSources(undefined)).toHaveLength(7);
    });

    it('appends custom values after the seeds', () => {
        const out = resolveReferralSources(['Magazine ad', 'Trade show']);
        expect(out.slice(0, 7)).toEqual([...SEED_REFERRAL_SOURCES]);
        expect(out.slice(7)).toEqual(['Magazine ad', 'Trade show']);
    });

    it('drops empty / whitespace-only entries', () => {
        const out = resolveReferralSources(['', '   ', 'Trade show', '  ']);
        expect(out).toEqual([...SEED_REFERRAL_SOURCES, 'Trade show']);
    });

    it('de-dupes against seeds case-insensitively', () => {
        // "REALTOR" must not double up — it matches the seed "Realtor".
        const out = resolveReferralSources(['REALTOR', 'realtor', 'New label']);
        expect(out).toEqual([...SEED_REFERRAL_SOURCES, 'New label']);
    });

    it('de-dupes within the custom list itself', () => {
        const out = resolveReferralSources(['Magazine ad', 'magazine AD', 'Trade show']);
        expect(out).toEqual([...SEED_REFERRAL_SOURCES, 'Magazine ad', 'Trade show']);
    });
});

describe('UpdateBrandingSchema — customReferralSources (G3)', () => {
    it('accepts an array of labels', () => {
        const parsed = UpdateBrandingSchema.parse({
            customReferralSources: ['Magazine ad', 'Trade show'],
        });
        expect(parsed.customReferralSources).toEqual(['Magazine ad', 'Trade show']);
    });

    it('rejects more than 32 entries', () => {
        const tooMany = Array.from({ length: 33 }, (_, i) => `label-${i}`);
        expect(() => UpdateBrandingSchema.parse({ customReferralSources: tooMany })).toThrow();
    });

    it('rejects entries longer than 50 chars', () => {
        expect(() => UpdateBrandingSchema.parse({
            customReferralSources: ['X'.repeat(51)],
        })).toThrow();
    });

    it('rejects empty-string entries', () => {
        expect(() => UpdateBrandingSchema.parse({
            customReferralSources: [''],
        })).toThrow();
    });
});
