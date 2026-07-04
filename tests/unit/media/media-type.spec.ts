import { describe, it, expect } from 'vitest';
import { resolveMediaType, isVideoEntry } from '../../../server/lib/media/media-type';
import type { MediaEntry } from '../../../server/types/inspection-item-state';

describe('resolveMediaType', () => {
    it('treats a legacy entry with no discriminator as a photo', () => {
        expect(resolveMediaType({ key: 'a/b/c.jpg' })).toBe('photo');
    });

    it('resolves an explicit video entry as video', () => {
        expect(resolveMediaType({ key: '', mediaType: 'video', streamUid: 'abc123' })).toBe('video');
    });

    it('resolves an explicit photo entry as photo', () => {
        expect(resolveMediaType({ key: 'x', mediaType: 'photo' })).toBe('photo');
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
