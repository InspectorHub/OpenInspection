/**
 * `dropPendingPhoto` removes the pending entry whose bytes the host permanently refused. The entry is addressed by its
 * pending id (a new offline photo has an empty key), only that entry goes, an uploaded photo and the item's notes
 * stay, and a second drop of the same id is a no-op.
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { dropPendingPhoto } from './pending-photo-drop';
import { appendPendingPhoto, readResultMap, setNotes } from './results-binding';
import { appendPhoto } from '../shared/results-doc';

const FK = '_default:s1:i1';
type Photo = { key: string; pendingId?: string };
const photosOf = (doc: Y.Doc) => ((readResultMap(doc)[FK] as { photos?: Photo[] } | undefined)?.photos ?? []);

describe('dropPendingPhoto', () => {
  it('removes only the entry with that pending id', () => {
    const doc = new Y.Doc();
    appendPendingPhoto(doc, FK, 'p1');
    appendPendingPhoto(doc, FK, 'p2');
    dropPendingPhoto(doc, FK, 'p1');
    expect(photosOf(doc).map((p) => p.pendingId)).toEqual(['p2']);
  });

  it('keeps an uploaded photo and the notes of the item', () => {
    const doc = new Y.Doc();
    setNotes(doc, 's1', 'i1', 'Cracked flashing');
    appendPhoto(doc, FK, { key: 'tenant/photo-1.jpg' });
    appendPendingPhoto(doc, FK, 'p1');
    dropPendingPhoto(doc, FK, 'p1');
    expect(photosOf(doc).map((p) => p.key)).toEqual(['tenant/photo-1.jpg']);
    expect((readResultMap(doc)[FK] as { notes?: string }).notes).toBe('Cracked flashing');
  });

  it('is a no-op when the id is not there, and when it is dropped twice', () => {
    const doc = new Y.Doc();
    appendPendingPhoto(doc, FK, 'p1');
    dropPendingPhoto(doc, FK, 'nope');
    expect(photosOf(doc).map((p) => p.pendingId)).toEqual(['p1']);
    dropPendingPhoto(doc, FK, 'p1');
    dropPendingPhoto(doc, FK, 'p1');
    expect(photosOf(doc)).toEqual([]);
  });

  it('writes nothing to the document when the finding is absent: no empty item is created or synced', () => {
    const doc = new Y.Doc();
    appendPendingPhoto(doc, FK, 'p1');
    const before = Y.encodeStateAsUpdate(doc);
    const keysBefore = Object.keys(readResultMap(doc));
    const updates: Uint8Array[] = [];
    doc.on('update', (u: Uint8Array) => updates.push(u));
    dropPendingPhoto(doc, '_default:s9:i9', 'p1');
    expect(updates).toEqual([]);
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
    expect(Object.keys(readResultMap(doc))).toEqual(keysBefore);
    // CONTROL - the same id on the finding that does hold it is removed, and that is a real document update.
    dropPendingPhoto(doc, FK, 'p1');
    expect(updates.length).toBeGreaterThan(0);
    expect(photosOf(doc)).toEqual([]);
  });

  it('writes nothing when the item exists but has no photos array', () => {
    const doc = new Y.Doc();
    setNotes(doc, 's1', 'i1', 'Only notes');
    const before = Y.encodeStateAsUpdate(doc);
    dropPendingPhoto(doc, FK, 'p1');
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  });
});
