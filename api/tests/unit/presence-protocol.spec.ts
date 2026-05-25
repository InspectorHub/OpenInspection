import { describe, it, expect } from 'vitest';
import {
    encodeMessage,
    decodeMessage,
    rosterDiff,
} from '../../public/js/presence-protocol.js';

describe('presence protocol (subsystem B phase 2)', () => {
    it('encodes hello', () => {
        const out = encodeMessage({ type: 'hello', userId: 'u1', name: 'Eli', photoUrl: null });
        expect(JSON.parse(out).type).toBe('hello');
    });

    it('decodes valid roster', () => {
        const m = decodeMessage(JSON.stringify({ type: 'roster', users: [{ userId: 'u1', name: 'Eli', focusItemId: null }] }));
        expect(m).toMatchObject({ type: 'roster' });
        expect(Array.isArray((m as { users?: unknown[] } | null)?.users)).toBe(true);
    });

    it('decodes returns null on invalid JSON', () => {
        expect(decodeMessage('not json')).toBeNull();
    });

    it('decodes returns null on missing type', () => {
        expect(decodeMessage(JSON.stringify({ users: [] }))).toBeNull();
    });

    it('decodes returns null on unknown type', () => {
        expect(decodeMessage(JSON.stringify({ type: 'bogus' }))).toBeNull();
    });

    it('rosterDiff identifies joiners and leavers', () => {
        const prev = [{ userId: 'a' }, { userId: 'b' }];
        const next = [{ userId: 'b' }, { userId: 'c' }];
        const diff = rosterDiff(prev, next);
        expect(diff.joined.map(u => u.userId)).toEqual(['c']);
        expect(diff.left.map(u => u.userId)).toEqual(['a']);
    });

    it('rosterDiff with identical lists returns no joiners/leavers', () => {
        const same = [{ userId: 'a' }, { userId: 'b' }];
        const diff = rosterDiff(same, same.slice());
        expect(diff.joined).toEqual([]);
        expect(diff.left).toEqual([]);
    });
});
