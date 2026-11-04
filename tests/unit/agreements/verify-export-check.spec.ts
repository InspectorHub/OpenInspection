import { describe, it, expect } from 'vitest';
import { matchesAny, normalizeEmail, normalizePostalCode } from '../../../server/lib/verify-export-check';

describe('the export knowledge check, normalisation and comparison', () => {
    it('normalises an email by trimming and lower-casing only', () => {
        expect(normalizeEmail('  Jane.Doe@Example.TEST ')).toBe('jane.doe@example.test');
    });

    it('normalises a postal code: spaces and hyphens removed, upper case, and a nine-digit US code reduced to five digits', () => {
        expect(normalizePostalCode(' 78701-1234 ')).toBe('78701');
        expect(normalizePostalCode('787011234')).toBe('78701');
        expect(normalizePostalCode('78701')).toBe('78701');
        expect(normalizePostalCode('k1a 0b1')).toBe('K1A0B1');
        expect(normalizePostalCode('sw1a-1aa')).toBe('SW1A1AA');
        // Control: eight digits is not a ZIP+4 and is left whole.
        expect(normalizePostalCode('78701123')).toBe('78701123');
    });

    it('matches any candidate and reports a miss, with every candidate compared', () => {
        expect(matchesAny('b', ['a', 'b', 'c'])).toBe(true);
        expect(matchesAny('d', ['a', 'b', 'c'])).toBe(false);
        expect(matchesAny('a', [])).toBe(false);
        expect(matchesAny('', ['', 'a'])).toBe(false);
    });
});
