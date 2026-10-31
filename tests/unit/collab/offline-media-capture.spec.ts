// @vitest-environment happy-dom
/**
 * #181 PR-G — offline media capture → pending doc entry → drain → swap.
 *
 * Exercises the wiring layer added in Task G2 directly against a Y.Doc + the
 * offline media queue (fake-indexeddb, no server):
 *   - appendPendingPhoto writes a pending entry (empty key + pendingUpload).
 *   - markPhotoPending marks an existing photo's offline crop/annotate (keeps key).
 *   - a stubbed drain (resolvePendingPhoto as onUploaded) swaps the entry to the
 *     real R2 key and clears the pending markers.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import {
    seedResultsDoc,
    projectResults,
    appendPhoto,
} from '@core/field-ui/shared/results-doc';
import {
    appendPendingPhoto,
    markPhotoPending,
    resolvePendingPhoto,
} from '@core/field-ui/collab/results-binding';
import {
    enqueueMedia,
    drainMediaQueue,
    type MediaUploader,
} from '@core/field-ui/collab/media-upload-queue';
import { webMediaStore } from '~/lib/field/web-media-store';
import type { PendingMediaRecord } from '@core/field-ui/media-types';

const FK = '_default:s1:i1';
// The web pending store refuses a photo whose leading bytes are not jpeg, png or heic, so a fixture photo starts with
// a jpeg signature (the rest of the bytes do not matter to these specs).
const JPEG_HEADER = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

async function clearStore(): Promise<void> {
    const all = await webMediaStore.list();
    for (const r of all) await webMediaStore.delete(r.pendingId);
}

beforeEach(async () => {
    await clearStore();
});

/** The drain's doc swap, as the editor hook performs it. */
function swap(doc: Y.Doc, rec: PendingMediaRecord, result: { key?: string; croppedKey?: string; annotatedKey?: string }): void {
    resolvePendingPhoto(doc, rec.meta.findingKey, rec.pendingId, rec.kind, rec.kind === 'photo' ? undefined : rec.meta.photoKey, result);
}

function freshDoc(): Y.Doc {
    const doc = new Y.Doc();
    seedResultsDoc(doc, [{ findingKey: FK }]);
    return doc;
}

function photos(doc: Y.Doc): NonNullable<ReturnType<typeof projectResults>[string]['photos']> {
    return projectResults(doc)[FK].photos ?? [];
}

describe('offline photo ADD → pending entry → drain swaps to real key', () => {
    it('appends a pending entry, enqueues the blob, then drain resolves it', async () => {
        const doc = freshDoc();
        const pendingId = 'pid-photo-1';
        const blob = new Blob([JPEG_HEADER, 'photo-bytes'], { type: 'image/jpeg' });

        // Offline capture: enqueue + write the pending doc entry.
        await enqueueMedia(webMediaStore, {
            pendingId,
            inspectionId: 'insp-1',
            kind: 'photo',
            blob,
            meta: { targetType: 'item', findingKey: FK, itemId: 'i1' },
            createdAt: Date.now(),
        });
        appendPendingPhoto(doc, FK, pendingId);

        // The doc holds a pending entry: empty key + pendingUpload + pendingId.
        const before = photos(doc);
        expect(before).toHaveLength(1);
        expect(before[0].key).toBe('');
        expect(before[0].pendingUpload).toBe(true);
        expect(before[0].pendingId).toBe(pendingId);
        expect(before[0].pendingKind).toBe('photo');

        // The report (pendingUpload filter) would skip it — assert the marker.
        expect(before[0].pendingUpload).toBe(true);

        // Drain with a stub uploader; resolvePendingPhoto is the onUploaded swap.
        const uploader: MediaUploader = {
            upload: async () => ({ key: 'r2/real-photo-key' }),
        };
        const summary = await drainMediaQueue({
            inspectionId: 'insp-1',
            store: webMediaStore,
            uploader,
            onUploaded: (rec, result) => swap(doc, rec, result),
        });

        expect(summary).toEqual({ uploaded: 1, failed: 0 });

        // The entry is swapped to the real key with all pending markers cleared.
        const after = photos(doc);
        expect(after).toHaveLength(1);
        expect(after[0].key).toBe('r2/real-photo-key');
        expect(after[0].pendingUpload).toBeUndefined();
        expect(after[0].pendingId).toBeUndefined();
        expect(after[0].pendingKind).toBeUndefined();

        // The local blob was drained out of the store.
        expect(await webMediaStore.list('insp-1')).toHaveLength(0);
    });

    it('two concurrent offline adds resolve independently (matched by pendingId)', async () => {
        const doc = freshDoc();
        await enqueueMedia(webMediaStore, { pendingId: 'A', inspectionId: 'insp-1', kind: 'photo', blob: new Blob([JPEG_HEADER, 'a']), meta: { targetType: 'item', findingKey: FK, itemId: 'i1' }, createdAt: 1 });
        await enqueueMedia(webMediaStore, { pendingId: 'B', inspectionId: 'insp-1', kind: 'photo', blob: new Blob([JPEG_HEADER, 'b']), meta: { targetType: 'item', findingKey: FK, itemId: 'i1' }, createdAt: 2 });
        appendPendingPhoto(doc, FK, 'A');
        appendPendingPhoto(doc, FK, 'B');

        // Both pending entries have an empty key; the swap must match by pendingId.
        const uploader: MediaUploader = {
            upload: async (rec) => ({ key: `r2/${rec.pendingId}` }),
        };
        await drainMediaQueue({
            inspectionId: 'insp-1',
            store: webMediaStore,
            uploader,
            onUploaded: (rec, result) => swap(doc, rec, result),
        });

        const keys = photos(doc).map((p) => p.key).sort();
        expect(keys).toEqual(['r2/A', 'r2/B']);
        expect(photos(doc).every((p) => !p.pendingId)).toBe(true);
    });
});

describe('offline CROP of an existing photo → keeps base key, drain sets croppedKey', () => {
    it('marks pending-crop without pendingUpload, then drain swaps in croppedKey', async () => {
        const doc = freshDoc();
        appendPhoto(doc, FK, { key: 'r2/base.jpg', mediaType: 'photo' });

        const pendingId = 'pid-crop-1';
        const crop = { aspect: '3:2', orientation: 'landscape' as const, x: 0, y: 0, width: 100, height: 66 };
        await enqueueMedia(webMediaStore, {
            pendingId,
            inspectionId: 'insp-1',
            kind: 'crop',
            blob: new Blob(['cropped']),
            meta: { findingKey: FK, itemId: 'i1', photoIndex: 0, photoKey: 'r2/base.jpg', crop },
            createdAt: Date.now(),
        });
        markPhotoPending(doc, FK, 'r2/base.jpg', pendingId, 'crop', { crop });

        // Base key kept (report still serves it); NO pendingUpload set.
        const before = photos(doc)[0];
        expect(before.key).toBe('r2/base.jpg');
        expect(before.pendingUpload).toBeUndefined();
        expect(before.pendingId).toBe(pendingId);
        expect(before.pendingKind).toBe('crop');
        expect(before.crop).toEqual(crop);

        const uploader: MediaUploader = {
            upload: async () => ({ croppedKey: 'r2/base-cropped.jpg' }),
        };
        await drainMediaQueue({
            inspectionId: 'insp-1',
            store: webMediaStore,
            uploader,
            onUploaded: (rec, result) => swap(doc, rec, result),
        });

        const after = photos(doc)[0];
        expect(after.key).toBe('r2/base.jpg');
        expect(after.croppedKey).toBe('r2/base-cropped.jpg');
        expect(after.pendingId).toBeUndefined();
        expect(after.pendingKind).toBeUndefined();
        expect(after.crop).toEqual(crop);
    });
});

describe('offline ANNOTATE of an existing photo → keeps base/cropped key', () => {
    it('marks pending-annotate, then drain swaps in annotatedKey', async () => {
        const doc = freshDoc();
        appendPhoto(doc, FK, { key: 'r2/base.jpg', croppedKey: 'r2/base-cropped.jpg' });

        const pendingId = 'pid-anno-1';
        const nodesJson = '[{"type":"rect"}]';
        await enqueueMedia(webMediaStore, {
            pendingId,
            inspectionId: 'insp-1',
            kind: 'annotate',
            blob: new Blob(['annotated']),
            meta: { findingKey: FK, itemId: 'i1', photoIndex: 0, photoKey: 'r2/base.jpg', nodesJson },
            createdAt: Date.now(),
        });
        markPhotoPending(doc, FK, 'r2/base.jpg', pendingId, 'annotate', { annotationsJson: nodesJson });

        const before = photos(doc)[0];
        expect(before.key).toBe('r2/base.jpg');
        expect(before.croppedKey).toBe('r2/base-cropped.jpg'); // crop survives annotate
        expect(before.pendingUpload).toBeUndefined();
        expect(before.pendingKind).toBe('annotate');
        expect(before.annotationsJson).toBe(nodesJson);

        const uploader: MediaUploader = {
            upload: async () => ({ annotatedKey: 'r2/base-annotated.png' }),
        };
        await drainMediaQueue({
            inspectionId: 'insp-1',
            store: webMediaStore,
            uploader,
            onUploaded: (rec, result) => swap(doc, rec, result),
        });

        const after = photos(doc)[0];
        expect(after.key).toBe('r2/base.jpg');
        expect(after.croppedKey).toBe('r2/base-cropped.jpg');
        expect(after.annotatedKey).toBe('r2/base-annotated.png');
        expect(after.pendingId).toBeUndefined();
        expect(after.pendingKind).toBeUndefined();
    });
});
