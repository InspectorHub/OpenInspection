import { describe, it, expect } from 'vitest';
import { resolveByteRange } from '../../../server/lib/media/serve-video';

describe('resolveByteRange', () => {
    it('resolves the three single-range forms against the object size, clamping the end', () => {
        expect(resolveByteRange('bytes=10-29', 100)).toEqual({ start: 10, end: 29 });
        expect(resolveByteRange('bytes=90-500', 100)).toEqual({ start: 90, end: 99 });
        expect(resolveByteRange('bytes=95-', 100)).toEqual({ start: 95, end: 99 });
        expect(resolveByteRange('bytes=-4', 100)).toEqual({ start: 96, end: 99 });
        expect(resolveByteRange('bytes=-500', 100)).toEqual({ start: 0, end: 99 });
    });

    it('calls a range that starts at or past the end unsatisfiable, and a suffix of zero too', () => {
        expect(resolveByteRange('bytes=100-', 100)).toBe('unsatisfiable');
        expect(resolveByteRange('bytes=250-300', 100)).toBe('unsatisfiable');
        expect(resolveByteRange('bytes=-0', 100)).toBe('unsatisfiable');
        expect(resolveByteRange('bytes=0-', 0)).toBe('unsatisfiable');
    });

    it('ignores what it does not serve (control: the forms above do resolve)', () => {
        expect(resolveByteRange(undefined, 100)).toBeNull();
        expect(resolveByteRange('bytes=0-1,5-6', 100)).toBeNull();
        expect(resolveByteRange('items=0-5', 100)).toBeNull();
        expect(resolveByteRange('bytes=-', 100)).toBeNull();
        expect(resolveByteRange('bytes=30-10', 100)).toBeNull();
    });
});
