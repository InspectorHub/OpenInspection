/**
 * #475 — a photo pinned to a defect row (or a burst set) taken offline must
 * go through the same offline queue as an item photo: bytes in the local
 * pending store, a pending entry on the DEFECT row (so the chip counts it),
 * and the drain swapping the real R2 key into that row — never the item's
 * photos. Three frames of one defect must survive as three entries, not
 * one: pending entries share the empty key, so dedup is by pendingId.
 *
 * (Credit: NCHILLC's fork, commit 85669e05, which proved the same shape
 * with `offline-media-capture.spec.ts`; reimplemented here for upstream.)
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { addOfflinePhotos } from './offline-photo-batch';
import { drainMediaQueue } from './media-upload-queue';
import {
    appendPendingPhotoToDefect,
    dropPendingDefectPhoto,
    resolvePendingDefectPhoto,
} from './defect-photo-binding';
import { readResultMap } from './results-binding';
import { upsertCanned, upsertCustomComment } from '../shared/results-doc';
import type { PendingMediaRecord, PendingMediaStore } from '../media-types';

const FK = '_default:s1:i1';

type Photo = { key: string; pendingUpload?: boolean; pendingId?: string };
type DefectRow = { cannedId?: string; id?: string; photos?: Photo[] };

function defectPhotos(doc: Y.Doc, kind: 'canned' | 'custom', id: string): Photo[] {
    const entry = readResultMap(doc)[FK] as
        | {
            tabs?: { defects?: DefectRow[] };
            customComments?: { defects?: DefectRow[] };
        }
        | undefined;
    const rows = kind === 'canned' ? entry?.tabs?.defects : entry?.customComments?.defects;
    return rows?.find((r) => (kind === 'canned' ? r.cannedId : r.id) === id)?.photos ?? [];
}

function itemPhotos(doc: Y.Doc): Photo[] {
    return ((readResultMap(doc)[FK] as { photos?: Photo[] } | undefined)?.photos ?? []);
}

function memoryStore(): PendingMediaStore & { records: PendingMediaRecord[] } {
    const records: PendingMediaRecord[] = [];
    return {
        records,
        async put(rec) {
            records.push(rec);
        },
        async get(pendingId) {
            return records.find((r) => r.pendingId === pendingId) ?? null;
        },
        async list(inspectionId) {
            return inspectionId === undefined ? [...records] : records.filter((r) => r.inspectionId === inspectionId);
        },
        async delete(pendingId) {
            const i = records.findIndex((r) => r.pendingId === pendingId);
            if (i >= 0) records.splice(i, 1);
        },
        async objectUrl() {
            return null;
        },
    };
}

function seedCannedDefect(doc: Y.Doc) {
    upsertCanned(doc, FK, 'defects', { cannedId: 'c1', included: true });
}

function seedCustomDefect(doc: Y.Doc) {
    upsertCustomComment(doc, FK, 'defects', { id: 'x1', included: true });
}

const blob = () => new Blob(['fake-jpeg'], { type: 'image/jpeg' });

describe('offline defect photos (#475)', () => {
    it('queues a canned-defect photo on the defect row, not the item', async () => {
        const doc = new Y.Doc();
        seedCannedDefect(doc);
        const store = memoryStore();
        const batch = await addOfflinePhotos(store, doc, {
            inspectionId: 'insp-1',
            findingKey: FK,
            itemId: 'i1',
            source: 'camera',
            defectTarget: { kind: 'canned', id: 'c1' },
            sectionId: 's1',
        }, [blob()]);
        expect(batch.rejected).toBe(0);
        expect(store.records).toHaveLength(1);
        expect(store.records[0].kind).toBe('photo');
        if (store.records[0].kind === 'photo') {
            expect(store.records[0].meta.targetType).toBe('defect');
        }
        const pending = defectPhotos(doc, 'canned', 'c1');
        expect(pending).toHaveLength(1);
        expect(pending[0].key).toBe('');
        expect(pending[0].pendingUpload).toBe(true);
        expect(pending[0].pendingId).toBe(store.records[0].pendingId);
        expect(itemPhotos(doc)).toHaveLength(0);
    });

    it('three frames on one defect stay three pending entries (dedup by pendingId)', async () => {
        const doc = new Y.Doc();
        seedCannedDefect(doc);
        const store = memoryStore();
        await addOfflinePhotos(store, doc, {
            inspectionId: 'insp-1',
            findingKey: FK,
            itemId: 'i1',
            source: 'burst',
            defectTarget: { kind: 'canned', id: 'c1' },
            sectionId: 's1',
        }, [blob(), blob(), blob()]);
        expect(defectPhotos(doc, 'canned', 'c1')).toHaveLength(3);
        expect(new Set(defectPhotos(doc, 'canned', 'c1').map((p) => p.pendingId)).size).toBe(3);
    });

    it('the drain swaps the real key into the defect row', async () => {
        const doc = new Y.Doc();
        seedCannedDefect(doc);
        const store = memoryStore();
        await addOfflinePhotos(store, doc, {
            inspectionId: 'insp-1',
            findingKey: FK,
            itemId: 'i1',
            source: 'camera',
            defectTarget: { kind: 'canned', id: 'c1' },
            sectionId: 's1',
        }, [blob()]);
        await drainMediaQueue({
            inspectionId: 'insp-1',
            store,
            uploader: { upload: async () => ({ key: 'r2/defect-1.jpg' }) },
            onUploaded: (rec, result) => {
                if (rec.kind === 'photo' && rec.meta.targetType === 'defect' && result.key) {
                    resolvePendingDefectPhoto(doc, rec.meta.findingKey, { kind: rec.meta.defectKind, id: rec.meta.customId }, rec.pendingId, result.key);
                }
            },
        });
        const photos = defectPhotos(doc, 'canned', 'c1');
        expect(photos).toEqual([{ key: 'r2/defect-1.jpg', mediaType: 'photo' }]);
        expect(itemPhotos(doc)).toHaveLength(0);
        expect(store.records).toHaveLength(0);
    });

    it('a custom-defect photo queues and resolves the same way', async () => {
        const doc = new Y.Doc();
        seedCustomDefect(doc);
        const store = memoryStore();
        await addOfflinePhotos(store, doc, {
            inspectionId: 'insp-1',
            findingKey: FK,
            itemId: 'i1',
            source: 'library',
            defectTarget: { kind: 'custom', id: 'x1' },
            sectionId: 's1',
        }, [blob()]);
        expect(defectPhotos(doc, 'custom', 'x1')).toHaveLength(1);
        const pendingId = store.records[0].pendingId;
        resolvePendingDefectPhoto(doc, FK, { kind: 'custom', id: 'x1' }, pendingId, 'r2/custom-1.jpg');
        expect(defectPhotos(doc, 'custom', 'x1')).toEqual([{ key: 'r2/custom-1.jpg', mediaType: 'photo' }]);
    });

    it('dropping a refused defect photo removes only that pending entry', () => {
        const doc = new Y.Doc();
        seedCannedDefect(doc);
        appendPendingPhotoToDefect(doc, 's1', 'i1', { kind: 'canned', id: 'c1' }, 'p1');
        appendPendingPhotoToDefect(doc, 's1', 'i1', { kind: 'canned', id: 'c1' }, 'p2');
        dropPendingDefectPhoto(doc, FK, { kind: 'canned', id: 'c1' }, 'p1');
        expect(defectPhotos(doc, 'canned', 'c1').map((p) => p.pendingId)).toEqual(['p2']);
        dropPendingDefectPhoto(doc, FK, { kind: 'canned', id: 'c1' }, 'nope');
        expect(defectPhotos(doc, 'canned', 'c1')).toHaveLength(1);
    });

    it('appending to a missing defect row is a no-op, not a created row', () => {
        const doc = new Y.Doc();
        appendPendingPhotoToDefect(doc, 's1', 'i1', { kind: 'canned', id: 'ghost' }, 'p1');
        expect(Object.keys(readResultMap(doc))).toEqual([]);
    });
});
