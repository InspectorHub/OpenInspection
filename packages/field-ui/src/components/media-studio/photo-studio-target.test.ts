import { describe, expect, it } from 'vitest';
import { photoStudioTarget } from './photo-studio-target';
import type { PhotoEntry } from '../../shared/results-doc.types';

const photoUrl = (id: string, key: string, variant?: string) => `/api/inspections/${id}/photo?key=${encodeURIComponent(key)}&v=${variant ?? ''}`;

describe('photoStudioTarget', () => {
    it('opens the first photo by its key string, never by the entry object', () => {
        const photos: PhotoEntry[] = [{ key: 't/i/photos/a.jpg' }, { key: 't/i/photos/b.jpg' }];
        const t = photoStudioTarget(photos, 'insp-1', photoUrl);
        expect(t).toEqual({ url: '/api/inspections/insp-1/photo?key=t%2Fi%2Fphotos%2Fa.jpg&v=original', key: 't/i/photos/a.jpg', index: 1, total: 2 });
        expect(t.url).not.toContain('object');
    });

    it('annotates on top of the crop and never on top of an existing annotation', () => {
        const t = photoStudioTarget([{ key: 'orig.jpg', croppedKey: 'crop.jpg', annotatedKey: 'ann.png' }], 'i', photoUrl);
        expect(t.url).toContain(encodeURIComponent('crop.jpg'));
        expect(t.url).not.toContain('ann.png');
        expect(t.key).toBe('orig.jpg');
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
        expect(t.total).toBe(1);
    });

    it('returns an empty target when there is nothing to open', () => {
        expect(photoStudioTarget(undefined, 'i', photoUrl)).toEqual({ url: null, key: null, index: 0, total: 0 });
        expect(photoStudioTarget([{ key: 'c.webm', mediaType: 'video' }], 'i', photoUrl)).toEqual({ url: null, key: null, index: 0, total: 0 });
    });
});
