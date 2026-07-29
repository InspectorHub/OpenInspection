import { describe, it, expect } from 'vitest';
import { whitelistOverrides, coerceOverrides } from '../../../server/lib/auth/capability-overrides';

const DECL = { alpha: 'boolean', beta: ['off', 'read', 'readwrite'] } as const;

describe('whitelistOverrides', () => {
    it('keeps a declared boolean', () => {
        expect(whitelistOverrides(DECL, { alpha: true })).toEqual({ alpha: true });
    });

    it('keeps a declared enum value', () => {
        expect(whitelistOverrides(DECL, { beta: 'read' })).toEqual({ beta: 'read' });
    });

    it('drops an enum value outside the declaration', () => {
        expect(whitelistOverrides(DECL, { beta: 'admin' })).toBeNull();
    });

    it('drops a boolean supplied to an enum bit', () => {
        expect(whitelistOverrides(DECL, { beta: true })).toBeNull();
    });

    it('drops keys not in the declaration', () => {
        expect(whitelistOverrides(DECL, { gamma: true })).toBeNull();
    });

    it('returns null when nothing survives', () => {
        expect(whitelistOverrides(DECL, {})).toBeNull();
    });
});

describe('coerceOverrides', () => {
    it('parses a JSON string', () => {
        expect(coerceOverrides(DECL, '{"alpha":false}')).toEqual({ alpha: false });
    });

    it('accepts an already-parsed object', () => {
        expect(coerceOverrides(DECL, { alpha: false })).toEqual({ alpha: false });
    });

    it('collapses malformed JSON to null', () => {
        expect(coerceOverrides(DECL, '{oops')).toBeNull();
    });

    it('collapses null and numbers to null', () => {
        expect(coerceOverrides(DECL, null)).toBeNull();
        expect(coerceOverrides(DECL, 42)).toBeNull();
    });
});
