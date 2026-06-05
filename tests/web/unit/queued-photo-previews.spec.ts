/**
 * Unit tests for the pure queuedPhotoPreviews helpers
 * (app/lib/offline/queued-photo-previews.ts).
 */

import { describe, it, expect } from 'vitest';
import {
    addQueuedPreview,
    clearQueuedPreviews,
    collectObjectUrls,
    type QueuedPreviewMap,
} from '~/lib/offline/queued-photo-previews';

describe('addQueuedPreview', () => {
    it('appends a preview entry for a new itemId', () => {
        const map: QueuedPreviewMap = {};
        const result = addQueuedPreview(map, 'item-1', { name: 'photo.jpg', objectUrl: 'blob:x' });
        expect(result['item-1']).toHaveLength(1);
        expect(result['item-1'][0]).toEqual({ name: 'photo.jpg', objectUrl: 'blob:x' });
    });

    it('appends without mutating existing entries for the same itemId', () => {
        const map: QueuedPreviewMap = { 'item-1': [{ name: 'a.jpg', objectUrl: 'blob:a' }] };
        const result = addQueuedPreview(map, 'item-1', { name: 'b.jpg', objectUrl: 'blob:b' });
        expect(result['item-1']).toHaveLength(2);
        // original map unchanged
        expect(map['item-1']).toHaveLength(1);
    });

    it('does not affect other itemIds', () => {
        const map: QueuedPreviewMap = { 'item-2': [{ name: 'c.jpg', objectUrl: 'blob:c' }] };
        const result = addQueuedPreview(map, 'item-1', { name: 'a.jpg', objectUrl: 'blob:a' });
        expect(result['item-2']).toHaveLength(1);
    });
});

describe('clearQueuedPreviews', () => {
    it('returns an empty map regardless of input', () => {
        expect(clearQueuedPreviews()).toEqual({});
    });
});

describe('collectObjectUrls', () => {
    it('returns all object URLs across all items', () => {
        const map: QueuedPreviewMap = {
            'item-1': [{ name: 'a.jpg', objectUrl: 'blob:a' }, { name: 'b.jpg', objectUrl: 'blob:b' }],
            'item-2': [{ name: 'c.jpg', objectUrl: 'blob:c' }],
        };
        const urls = collectObjectUrls(map);
        expect(urls).toContain('blob:a');
        expect(urls).toContain('blob:b');
        expect(urls).toContain('blob:c');
        expect(urls).toHaveLength(3);
    });

    it('returns an empty array for an empty map', () => {
        expect(collectObjectUrls({})).toEqual([]);
    });
});
