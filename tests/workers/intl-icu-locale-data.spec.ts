// Guards the i18n foundation premise: workerd ships full ICU, so Intl formats
// non-English locales correctly (not an English fallback). If a runtime update
// ever regressed ICU data, server-side formatting would silently anglicize —
// this catches it. Verified 2026-07-16 for en-US + es-419.
import { describe, it, expect } from 'vitest';

const D = new Date('2026-07-17T12:00:00.000Z');

describe('workerd Intl ICU locale data', () => {
    it('formats es-419 with localized month + US-style numbers', () => {
        const date = new Intl.DateTimeFormat('es-419', {
            day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
        }).format(D);
        expect(date).toContain('julio');   // full ICU; English fallback = "July"
        expect(date).not.toContain('July');
        expect(new Intl.NumberFormat('es-419').format(1234567.89)).toBe('1,234,567.89');
    });
    it('formats en-US baseline correctly', () => {
        expect(new Intl.DateTimeFormat('en-US', {
            day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
        }).format(D)).toBe('July 17, 2026');
        expect(new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(1234.5))
            .toBe('$1,234.50');
    });
});
