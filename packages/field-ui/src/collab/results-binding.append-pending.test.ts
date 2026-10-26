/**
 * `appendPendingPhoto` is part of the package's public surface: a host that stored a photo's bytes on the device
 * adds the pending entry itself. The entry has an empty key and the pending markers; the same pending id twice
 * leaves one entry; two ids leave two; an item that already holds data keeps it.
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { appendPendingPhoto, readResultMap, setNotes } from './results-binding';

const FK = '_default:s1:i1';
type Photo = { key: string; pendingUpload?: boolean; pendingId?: string; pendingKind?: string; mediaType?: string };
const photosOf = (doc: Y.Doc) => ((readResultMap(doc)[FK] as { photos?: Photo[] } | undefined)?.photos ?? []);

describe('appendPendingPhoto', () => {
  it('adds a pending entry with an empty key and the pending markers', () => {
    const doc = new Y.Doc();
    appendPendingPhoto(doc, FK, 'p1');
    expect(photosOf(doc)).toEqual([{ key: '', pendingUpload: true, pendingId: 'p1', pendingKind: 'photo', mediaType: 'photo' }]);
  });

  it('the same pending id twice leaves one entry; two different ids leave two', () => {
    const doc = new Y.Doc();
    appendPendingPhoto(doc, FK, 'p1');
    appendPendingPhoto(doc, FK, 'p1');
    expect(photosOf(doc).map((p) => p.pendingId)).toEqual(['p1']);
    appendPendingPhoto(doc, FK, 'p2');
    expect(photosOf(doc).map((p) => p.pendingId)).toEqual(['p1', 'p2']);
  });

  it('an item that already holds notes keeps them', () => {
    const doc = new Y.Doc();
    setNotes(doc, 's1', 'i1', 'Cracked flashing');
    appendPendingPhoto(doc, FK, 'p1');
    expect((readResultMap(doc)[FK] as { notes?: string }).notes).toBe('Cracked flashing');
    expect(photosOf(doc)).toHaveLength(1);
  });
});
