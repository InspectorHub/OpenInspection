import { describe, it, expect } from 'vitest';
import { isValidLocale, resolveLocale } from '../../../server/lib/locale';

describe('resolveLocale', () => {
    it('accepts valid BCP-47 tags', () => {
        expect(resolveLocale('en-US')).toBe('en-US');
        expect(resolveLocale('es-419')).toBe('es-419');
    });
    it('falls back to en-US for empty/invalid input', () => {
        expect(resolveLocale(null)).toBe('en-US');
        expect(resolveLocale(undefined)).toBe('en-US');
        expect(resolveLocale('')).toBe('en-US');
        expect(resolveLocale('not a locale!!')).toBe('en-US');
    });
    it('isValidLocale rejects junk and accepts real tags', () => {
        expect(isValidLocale('es-419')).toBe(true);
        expect(isValidLocale('!!')).toBe(false);
    });
});
