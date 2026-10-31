/**
 * `dropPendingPhoto` removes the pending entry whose bytes the host permanently refused. The entry is addressed by its
 * pending id (a new offline photo has an empty key), only that entry goes, an uploaded photo and the item's notes
 * stay, and a second drop of the same id is a no-op.
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { clearPendingDerivative, dropPendingPhoto } from './pending-photo-drop';
import { appendPendingPhoto, markPhotoPending, readResultMap, setNotes } from './results-binding';
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

describe('clearPendingDerivative', () => {
  type Marked = { key: string; pendingId?: string; pendingKind?: string; croppedKey?: string; annotatedKey?: string };
  const marked = (doc: Y.Doc) => ((readResultMap(doc)[FK] as { photos?: Marked[] } | undefined)?.photos ?? []);
  const withPendingCrop = () => {
    const doc = new Y.Doc();
    appendPhoto(doc, FK, { key: 'base.jpg', mediaType: 'photo', annotatedKey: 'ann.png' } as never);
    appendPhoto(doc, FK, { key: 'other.jpg', mediaType: 'photo' });
    markPhotoPending(doc, FK, 'base.jpg', 'c1', 'crop', { crop: { aspect: 'free', orientation: 'landscape', x: 0, y: 0, width: 1, height: 1 } });
    return doc;
  };

  it('removes only the pending marker from the photo; the photo itself, its keys and its neighbours stay', () => {
    const doc = withPendingCrop();
    expect(marked(doc)[0]).toMatchObject({ key: 'base.jpg', pendingId: 'c1', pendingKind: 'crop' });
    clearPendingDerivative(doc, FK, 'base.jpg', 'c1');
    const [base, other] = marked(doc);
    expect(base?.key).toBe('base.jpg');
    expect(base).not.toHaveProperty('pendingId');
    expect(base).not.toHaveProperty('pendingKind');
    expect(other).toEqual({ key: 'other.jpg', mediaType: 'photo' });
    expect(marked(doc)).toHaveLength(2);
  });

  it('does not touch a marker with another pending id (a newer edit of the same photo)', () => {
    const doc = withPendingCrop();
    clearPendingDerivative(doc, FK, 'base.jpg', 'someone-else');
    expect(marked(doc)[0]).toMatchObject({ pendingId: 'c1', pendingKind: 'crop' });
  });

  it('writes nothing when the finding or the photo is absent: no empty item is created or synced', () => {
    const doc = withPendingCrop();
    const updates: Uint8Array[] = [];
    doc.on('update', (u: Uint8Array) => updates.push(u));
    const keysBefore = Object.keys(readResultMap(doc));
    clearPendingDerivative(doc, '_default:s9:i9', 'base.jpg', 'c1');
    clearPendingDerivative(doc, FK, 'gone.jpg', 'c1');
    expect(updates).toEqual([]);
    expect(Object.keys(readResultMap(doc))).toEqual(keysBefore);
    // CONTROL - the same call on the photo that carries the marker is a real document update.
    clearPendingDerivative(doc, FK, 'base.jpg', 'c1');
    expect(updates.length).toBeGreaterThan(0);
  });

  it('is safe to repeat', () => {
    const doc = withPendingCrop();
    clearPendingDerivative(doc, FK, 'base.jpg', 'c1');
    clearPendingDerivative(doc, FK, 'base.jpg', 'c1');
    expect(marked(doc)[0]).toMatchObject({ key: 'base.jpg' });
  });

  it('drops the unbaked annotation nodes when no annotated image exists, so no overlay is described without an image', () => {
    const doc = new Y.Doc();
    appendPhoto(doc, FK, { key: 'base.jpg', mediaType: 'photo' });
    markPhotoPending(doc, FK, 'base.jpg', 'a1', 'annotate', { annotationsJson: '[{"t":"rect"}]' });
    expect(marked(doc)[0]).toMatchObject({ annotationsJson: '[{"t":"rect"}]' });
    clearPendingDerivative(doc, FK, 'base.jpg', 'a1');
    expect(marked(doc)[0]).toEqual({ key: 'base.jpg', mediaType: 'photo' });
  });

  it('CONTROL - keeps the nodes of an annotation that does have an annotated image', () => {
    const doc = new Y.Doc();
    appendPhoto(doc, FK, { key: 'base.jpg', mediaType: 'photo', annotatedKey: 'ann.png', annotationsJson: '[1]' } as never);
    markPhotoPending(doc, FK, 'base.jpg', 'a1', 'annotate', {});
    clearPendingDerivative(doc, FK, 'base.jpg', 'a1');
    expect(marked(doc)[0]).toMatchObject({ annotatedKey: 'ann.png', annotationsJson: '[1]' });
  });
});
