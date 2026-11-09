import { describe, expect, it } from 'vitest';
import { photoStudioTarget, photoStudioTargetAt } from './photo-studio-target';
import type { PhotoEntry } from '../../shared/results-doc.types';

const photoUrl = (id: string, key: string, variant?: string) => `/api/inspections/${id}/photo?key=${encodeURIComponent(key)}&v=${variant ?? ''}`;

describe('photoStudioTarget', () => {
    it('opens the first photo by its key string, never by the entry object', () => {
        const photos: PhotoEntry[] = [{ key: 't/i/photos/a.jpg' }, { key: 't/i/photos/b.jpg' }];
        const t = photoStudioTarget(photos, 'insp-1', photoUrl);
        expect(t).toEqual({ url: '/api/inspections/insp-1/photo?key=t%2Fi%2Fphotos%2Fa.jpg&v=original', key: 't/i/photos/a.jpg', originalKey: 't/i/photos/a.jpg', index: 0, total: 2 });
        expect(t.url).not.toContain('object');
    });

    it('annotates on top of the crop and never on top of an existing annotation', () => {
        const t = photoStudioTarget([{ key: 'orig.jpg', croppedKey: 'crop.jpg', annotatedKey: 'ann.png' }], 'i', photoUrl);
        expect(t.url).toContain(encodeURIComponent('crop.jpg'));
        expect(t.url).not.toContain('ann.png');
        // The key is what the gallery shows (annotated wins); the url is the base the annotator draws on.
        expect(t.key).toBe('ann.png');
    });

    it('still reads a legacy entry that is a bare key string', () => {
        const t = photoStudioTarget(['legacy.jpg'], 'i', photoUrl);
        expect(t.key).toBe('legacy.jpg');
        expect(t.total).toBe(1);
    });

    it('skips videos and photos that are still only in the local pending store, and counts only what it can open', () => {
        const photos: PhotoEntry[] = [
            { key: 'clip.webm', mediaType: 'video' },
            { key: '', pendingUpload: true, pendingId: 'p1' },
            { key: 'real.jpg' },
        ];
        const t = photoStudioTarget(photos, 'i', photoUrl);
        expect(t.key).toBe('real.jpg');
        expect(t.index).toBe(2);
        expect(t.total).toBe(3);
    });

    it('returns an empty target when there is nothing to open', () => {
        expect(photoStudioTarget(undefined, 'i', photoUrl)).toEqual({ url: null, key: null, originalKey: null, index: 0, total: 0 });
        expect(photoStudioTarget([{ key: 'c.webm', mediaType: 'video' }], 'i', photoUrl)).toEqual({ url: null, key: null, originalKey: null, index: 0, total: 0 });
    });

    it('never puts the entry object in the url or key (regression: ?key=[object Object])', () => {
        const t = photoStudioTarget([{ key: 'a.jpg' }] as PhotoEntry[], 'i', photoUrl);
        expect(typeof t.key).toBe('string');
        expect(t.url).not.toContain('object');
        expect(t.url).not.toContain('%5Bobject');
    });

    it('index is the 0-based position in the photos array and total counts the array', () => {
        const photos: PhotoEntry[] = [{ key: 'a.jpg' }, { key: 'b.jpg' }, { key: 'c.jpg' }];
        expect(photoStudioTarget(photos, 'i', photoUrl)).toMatchObject({ index: 0, total: 3 });
        expect(photoStudioTargetAt(photos, 1, 'i', photoUrl)).toMatchObject({ key: 'b.jpg', index: 1, total: 3 });
        expect(photoStudioTargetAt(photos, 2, 'i', photoUrl)).toMatchObject({ key: 'c.jpg', index: 2, total: 3 });
    });
});

describe('the target addresses exactly the photo at its index', () => {
    // A clip sits between photos: clips have key '' (or any key) and are not photos, but they occupy array slots.
    const photos: PhotoEntry[] = [
        { key: 'p0.jpg' },
        { key: '', mediaType: 'video' },
        { key: 'p2.jpg', croppedKey: 'p2-crop.jpg' },
        { key: 'p3.jpg', croppedKey: 'p3-crop.jpg', annotatedKey: 'p3-ann.png' },
    ];

    it('first photo', () => {
        const t = photoStudioTarget(photos, 'i', photoUrl);
        expect(t.index).toBe(0);
        expect(photos[t.index]!.key).toBe(t.key);
    });

    it('a photo after a clip keeps its array index, not its position among photos', () => {
        const t = photoStudioTargetAt(photos, 2, 'i', photoUrl);
        expect(t.index).toBe(2);
        // The cropped photo shows its crop, and the annotator draws on that crop.
        expect(t.key).toBe('p2-crop.jpg');
        expect(photos[t.index]!.croppedKey).toBe(t.key);
        expect(t.url).toContain(encodeURIComponent('p2-crop.jpg'));
    });

    it('an annotated photo opens by its annotated key and draws on its crop', () => {
        const t = photoStudioTargetAt(photos, 3, 'i', photoUrl);
        expect(t.index).toBe(3);
        expect(t.key).toBe('p3-ann.png');
        // The save finds the entry again by its ORIGINAL key, whatever it shows.
        expect(t.originalKey).toBe('p3.jpg');
        expect(photos[t.index]!.annotatedKey).toBe(t.key);
        expect(t.url).toContain(encodeURIComponent('p3-crop.jpg'));
        expect(t.url).not.toContain('p3-ann');
    });

    it('the first openable photo after a leading clip is index 1, not 0', () => {
        const t = photoStudioTarget([{ key: '', mediaType: 'video' }, { key: 'p1.jpg' }], 'i', photoUrl);
        expect(t.index).toBe(1);
        expect(t.key).toBe('p1.jpg');
    });

    it('a clip, a pending-only photo and an out-of-range index open nothing', () => {
        const empty = { url: null, key: null, originalKey: null, index: 0, total: 0 };
        expect(photoStudioTargetAt(photos, 1, 'i', photoUrl)).toEqual(empty);
        expect(photoStudioTargetAt([{ key: '', pendingUpload: true }], 0, 'i', photoUrl)).toEqual(empty);
        expect(photoStudioTargetAt(photos, 9, 'i', photoUrl)).toEqual(empty);
        expect(photoStudioTargetAt(photos, -1, 'i', photoUrl)).toEqual(empty);
    });
});
