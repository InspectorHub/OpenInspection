import { describe, it, expect } from 'vitest';
import { safeReturnTo } from '../../../server/lib/mcp/safe-return-to';

describe('safeReturnTo', () => {
    describe('valid same-origin paths — returned as-is', () => {
        it('returns a simple path', () => {
            expect(safeReturnTo('/inspections', '/default')).toBe('/inspections');
        });

        it('returns a path with query params', () => {
            expect(safeReturnTo('/oauth/authorize?x=1', '/default')).toBe('/oauth/authorize?x=1');
        });

        it('returns a path with multiple segments', () => {
            expect(safeReturnTo('/inspections/abc/edit', '/default')).toBe('/inspections/abc/edit');
        });
    });

    describe('protocol-relative URLs — rejected', () => {
        it('rejects //evil.test', () => {
            expect(safeReturnTo('//evil.test', '/default')).toBe('/default');
        });

        it('rejects //evil.test/path', () => {
            expect(safeReturnTo('//evil.test/path', '/default')).toBe('/default');
        });
    });

    describe('absolute URLs — rejected', () => {
        it('rejects https://evil.test/', () => {
            expect(safeReturnTo('https://evil.test/', '/default')).toBe('/default');
        });

        it('rejects http://evil.test/', () => {
            expect(safeReturnTo('http://evil.test/', '/default')).toBe('/default');
        });

        it('rejects javascript:alert(1)', () => {
            expect(safeReturnTo('javascript:alert(1)', '/default')).toBe('/default');
        });
    });

    describe('backslash paths — rejected', () => {
        it('rejects /\\evil (browsers treat as //evil)', () => {
            expect(safeReturnTo('/\\evil', '/default')).toBe('/default');
        });

        it('rejects a path with embedded backslash', () => {
            expect(safeReturnTo('/path\\to', '/default')).toBe('/default');
        });
    });

    describe('null / empty — fallback returned', () => {
        it('returns fallback for null', () => {
            expect(safeReturnTo(null, '/default')).toBe('/default');
        });

        it('returns fallback for undefined', () => {
            expect(safeReturnTo(undefined, '/default')).toBe('/default');
        });

        it('returns fallback for empty string', () => {
            expect(safeReturnTo('', '/default')).toBe('/default');
        });
    });
});
