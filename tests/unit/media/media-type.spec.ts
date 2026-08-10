import { describe, it, expect } from 'vitest';
import { resolveMediaType, isVideoEntry } from '../../../server/lib/media/media-type';
import type { MediaEntry } from '../../../server/types/inspection-item-state';

describe('resolveMediaType', () => {
    // `resolveMediaType` narrows its parameter to `{ mediaType?: string }`, so the
    // entries are declared as `MediaEntry` first — an object LITERAL carrying
    // `key` would trip excess-property checking, and dropping `key` would lose
    // the thing each case is describing.
    it('treats a legacy entry with no discriminator as a photo', () => {
        const legacy: MediaEntry = { key: 'a/b/c.jpg' };
        expect(resolveMediaType(legacy)).toBe('photo');
    });

    it('resolves an explicit video entry as video', () => {
        const video: MediaEntry = { key: '', mediaType: 'video', streamUid: 'abc123' };
        expect(resolveMediaType(video)).toBe('video');
    });

    it('resolves an explicit photo entry as photo', () => {
        const photo: MediaEntry = { key: 'x', mediaType: 'photo' };
        expect(resolveMediaType(photo)).toBe('photo');
    });
});

describe('isVideoEntry', () => {
    it('narrows true only when mediaType==="video" AND streamUid is non-empty', () => {
        const v: MediaEntry = { key: '', mediaType: 'video', streamUid: 'abc123' };
        expect(isVideoEntry(v)).toBe(true);
        if (isVideoEntry(v)) {
            // type guard narrows streamUid to string
            const uid: string = v.streamUid;
            expect(uid).toBe('abc123');
        }
    });

    it('returns false for a legacy photo entry', () => {
        expect(isVideoEntry({ key: 'a/b/c.jpg' })).toBe(false);
    });

    it('returns false for an explicit photo entry', () => {
        expect(isVideoEntry({ key: 'x', mediaType: 'photo' })).toBe(false);
    });

    it('returns false (defensive) when mediaType==="video" but streamUid is empty', () => {
        expect(isVideoEntry({ key: '', mediaType: 'video', streamUid: '' })).toBe(false);
        expect(isVideoEntry({ key: '', mediaType: 'video' })).toBe(false);
    });
});
