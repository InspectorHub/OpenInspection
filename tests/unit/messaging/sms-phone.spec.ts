import { describe, it, expect } from 'vitest';
import { normalizeE164 } from '../../../server/lib/sms/phone';

describe('normalizeE164 (US default)', () => {
    it('passes through already-E.164', () => {
        expect(normalizeE164('+15551234567')).toBe('+15551234567');
    });
    it('normalizes US 10-digit with punctuation', () => {
        expect(normalizeE164('(555) 123-4567')).toBe('+15551234567');
        expect(normalizeE164('555.123.4567')).toBe('+15551234567');
    });
    it('normalizes US 11-digit leading 1', () => {
        expect(normalizeE164('1-555-123-4567')).toBe('+15551234567');
    });
    it('returns null for unparseable / too short', () => {
        expect(normalizeE164('12345')).toBeNull();
        expect(normalizeE164('')).toBeNull();
        expect(normalizeE164(null)).toBeNull();
        expect(normalizeE164('not a phone')).toBeNull();
    });
});
