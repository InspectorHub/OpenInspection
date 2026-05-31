import { describe, it, expect } from 'vitest';
import {
    SlugSchema,
    SetSlugRequestSchema,
    SlugAvailabilityResponseSchema,
} from '../../src/lib/validations/profile.schema';

describe('SlugSchema', () => {
    it('accepts lowercase alphanum + hyphens, 3-32 chars', () => {
        expect(SlugSchema.parse('john')).toBe('john');
        expect(SlugSchema.parse('john-smith')).toBe('john-smith');
        expect(SlugSchema.parse('a1b2c3')).toBe('a1b2c3');
        expect(SlugSchema.parse('abc')).toBe('abc');
        expect(SlugSchema.parse('a'.repeat(32))).toHaveLength(32);
    });

    it('rejects too short or too long', () => {
        expect(() => SlugSchema.parse('ab')).toThrow();
        expect(() => SlugSchema.parse('a'.repeat(33))).toThrow();
    });

    it('rejects uppercase', () => {
        expect(() => SlugSchema.parse('John')).toThrow();
    });

    it('rejects underscores, dots, special chars', () => {
        expect(() => SlugSchema.parse('john_smith')).toThrow();
        expect(() => SlugSchema.parse('john.smith')).toThrow();
        expect(() => SlugSchema.parse('john smith')).toThrow();
    });

    it('rejects leading/trailing hyphens', () => {
        expect(() => SlugSchema.parse('-john')).toThrow();
        expect(() => SlugSchema.parse('john-')).toThrow();
    });

    it('rejects double hyphens', () => {
        expect(() => SlugSchema.parse('john--smith')).toThrow();
    });
});

describe('SetSlugRequestSchema', () => {
    it('accepts a valid slug payload', () => {
        const parsed = SetSlugRequestSchema.parse({ slug: 'john-smith' });
        expect(parsed.slug).toBe('john-smith');
    });

    it('rejects missing slug', () => {
        expect(() => SetSlugRequestSchema.parse({})).toThrow();
    });
});

describe('SlugAvailabilityResponseSchema', () => {
    it('accepts available=true alone', () => {
        const parsed = SlugAvailabilityResponseSchema.parse({ available: true });
        expect(parsed.available).toBe(true);
    });

    it('accepts taken with suggestions', () => {
        const parsed = SlugAvailabilityResponseSchema.parse({
            available: false,
            reason: 'taken',
            suggestions: ['john-2', 'john-3'],
        });
        expect(parsed.available).toBe(false);
        expect(parsed.reason).toBe('taken');
        expect(parsed.suggestions).toEqual(['john-2', 'john-3']);
    });

    it('rejects an invalid reason value', () => {
        expect(() =>
            SlugAvailabilityResponseSchema.parse({ available: false, reason: 'bogus' }),
        ).toThrow();
    });
});
