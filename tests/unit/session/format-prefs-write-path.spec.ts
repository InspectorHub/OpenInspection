/**
 * #270 — the WRITE path for the date/time format preferences.
 *
 * These assert the shape of what a PATCH body parses into, not what a handler
 * renders, because the defect this guards against is invisible at the render
 * layer: `.partial()` KEEPS `.default()`, so a schema field carrying a default
 * turns an omitted key into an explicitly-sent one, and the update silently
 * overwrites a preference the caller never mentioned. That has already caused
 * real data loss in this repo once (label data).
 *
 * So every assertion here is about the ABSENCE of a key. Asserting on a value
 * would pass against exactly the broken schema it is supposed to catch.
 */
import { describe, it, expect } from 'vitest';
import { PatchProfileSchema } from '../../../server/api/profile';
import { UpdateBrandingSchema } from '../../../server/lib/validations/admin/settings';

describe('tenant branding format preferences', () => {
    it('omits the format keys entirely when the caller does not send them', () => {
        const parsed = UpdateBrandingSchema.parse({ companyName: 'Acme Inspections' });
        expect(Object.keys(parsed)).not.toContain('dateFormat');
        expect(Object.keys(parsed)).not.toContain('timeFormat');
        expect('dateFormat' in parsed).toBe(false);
        expect('timeFormat' in parsed).toBe(false);
    });

    it('accepts the three date shapes and the two clocks', () => {
        for (const dateFormat of ['us', 'iso', 'eu']) {
            expect(UpdateBrandingSchema.parse({ dateFormat }).dateFormat).toBe(dateFormat);
        }
        for (const timeFormat of ['12h', '24h']) {
            expect(UpdateBrandingSchema.parse({ timeFormat }).timeFormat).toBe(timeFormat);
        }
    });

    it('rejects a value outside the enum rather than storing it', () => {
        expect(UpdateBrandingSchema.safeParse({ dateFormat: 'dd/mm/yyyy' }).success).toBe(false);
        expect(UpdateBrandingSchema.safeParse({ timeFormat: '13h' }).success).toBe(false);
        // The tenant value is the BOTTOM of the resolution chain, so unlike the
        // per-user override there is no "inherit" state to express.
        expect(UpdateBrandingSchema.safeParse({ dateFormat: '' }).success).toBe(false);
    });
});

describe('per-user format override', () => {
    it('omits the format keys entirely when the caller does not send them', () => {
        const parsed = PatchProfileSchema.parse({ name: 'Dana' });
        expect('dateFormat' in parsed).toBe(false);
        expect('timeFormat' in parsed).toBe(false);
    });

    it('keeps an empty string distinct from an absent key', () => {
        // '' is the CLEAR signal (handler writes NULL = inherit the tenant);
        // absent means "do not touch". Collapsing the two is the whole bug.
        const cleared = PatchProfileSchema.parse({ dateFormat: '', timeFormat: '' });
        expect(cleared.dateFormat).toBe('');
        expect(cleared.timeFormat).toBe('');
        const untouched = PatchProfileSchema.parse({});
        expect(untouched.dateFormat).toBeUndefined();
        expect('dateFormat' in untouched).toBe(false);
    });

    it('accepts the enum values and rejects anything else', () => {
        expect(PatchProfileSchema.parse({ dateFormat: 'eu' }).dateFormat).toBe('eu');
        expect(PatchProfileSchema.parse({ timeFormat: '24h' }).timeFormat).toBe('24h');
        expect(PatchProfileSchema.safeParse({ dateFormat: 'US' }).success).toBe(false);
        expect(PatchProfileSchema.safeParse({ timeFormat: '24' }).success).toBe(false);
    });
});
