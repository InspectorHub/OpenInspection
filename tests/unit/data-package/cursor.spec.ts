/** Stateless keyset cursor encode/decode tests (E-1 row reader). */
import { describe, it, expect } from 'vitest';
import { encodeCursor, decodeCursor } from '../../../server/lib/data-package/cursor';

describe('stateless data-package cursors', () => {
    it('round-trips a single string key', () => {
        const c = encodeCursor(['insp-123']);
        expect(c).not.toContain('=');
        expect(decodeCursor(c, ['string'])).toEqual(['insp-123']);
    });

    it('round-trips a composite key and a date+rowid key', () => {
        expect(decodeCursor(encodeCursor(['insp-1', 'user-2', 'tag-3']), ['string', 'string', 'string']))
            .toEqual(['insp-1', 'user-2', 'tag-3']);
        const esign = ['2026-01-01T00:00:00.000Z', 42] as const;
        expect(decodeCursor(encodeCursor(esign), ['string', 'number']))
            .toEqual(['2026-01-01T00:00:00.000Z', 42]);
    });

    it('refuses a cursor whose shape does not match the expected keyset', () => {
        const c = encodeCursor(['insp-1']);
        expect(decodeCursor(c, ['number'])).toBeNull();
        expect(decodeCursor(c, ['string', 'string'])).toBeNull();
        expect(decodeCursor(c, [])).toBeNull();
    });

    it('refuses non-finite numbers and wrong element types', () => {
        expect(decodeCursor(encodeCursor([42]), ['number'])).toEqual([42]);
        const wrongType = (json: string) => Buffer.from(json).toString('base64url');
        expect(decodeCursor(wrongType('[null]'), ['string'])).toBeNull();
        expect(decodeCursor(wrongType('[{}]'), ['string'])).toBeNull();
        // JSON.parse of an overflow literal yields a genuine Infinity, which
        // must be rejected by the Number.isFinite check (not just JSON nulls).
        const overflow = Buffer.from('[1e400]').toString('base64url');
        expect(decodeCursor(overflow, ['number'])).toBeNull();
    });

    it('round-trips a non-ASCII string key without throwing', () => {
        const c = encodeCursor(['café-用户-123']);
        expect(decodeCursor(c, ['string'])).toEqual(['café-用户-123']);
    });

    it('refuses malformed, empty, injected and oversized input', () => {
        expect(decodeCursor('', ['string'])).toBeNull();
        expect(decodeCursor('not base64!!', ['string'])).toBeNull();
        expect(decodeCursor('abc=def', ['string'])).toBeNull(); // '=' not in base64url alphabet
        expect(decodeCursor('x'.repeat(2049), ['string'])).toBeNull();
        // Valid base64url of a JSON object, not an array.
        const obj = Buffer.from('{"a":1}').toString('base64url');
        expect(decodeCursor(obj, ['string'])).toBeNull();
    });
});
