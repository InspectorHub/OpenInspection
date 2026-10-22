/**
 * Attaching a photo to an item must leave the item's rating and notes alone. The binding writes into the
 * item's own container, so a finding that holds a rating and notes keeps them when a photo key is appended
 * (also for a second photo and under a unit scope). The last case is the page-level hazard: before the
 * document has synced it holds nothing of the stored rating and notes, so the editor must merge, not adopt
 * (see results-merge.ts and useResultsProjection).
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { appendPhoto, readResultMap, setNotes, setRating } from './results-binding';
import { seedResultsDoc } from '../shared/results-doc';
import { mergeUnsyncedResults } from './results-merge';

const FK = '_default:s1:i1';

describe('attaching a photo keeps the rest of the finding', () => {
  it('rating and notes survive an appended photo key', () => {
    const doc = new Y.Doc();
    setRating(doc, 's1', 'i1', 'D');
    setNotes(doc, 's1', 'i1', 'Cracked flashing');
    appendPhoto(doc, 's1', 'i1', { key: 'r2/a.jpg' });
    const item = readResultMap(doc)[FK] as Record<string, unknown>;
    expect(item.rating).toBe('D');
    expect(item.notes).toBe('Cracked flashing');
    expect((item.photos as Array<{ key: string }>).map((p) => p.key)).toEqual(['r2/a.jpg']);
  });

  it('the same holds for a second photo', () => {
    const doc = new Y.Doc();
    setRating(doc, 's1', 'i1', 'NI');
    setNotes(doc, 's1', 'i1', 'n');
    appendPhoto(doc, 's1', 'i1', { key: 'r2/a.jpg' });
    appendPhoto(doc, 's1', 'i1', { key: 'r2/b.jpg' });
    const item = readResultMap(doc)[FK] as Record<string, unknown>;
    expect(item.rating).toBe('NI');
    expect(item.notes).toBe('n');
    expect(item.photos).toHaveLength(2);
  });

  it('under a unit scope the common finding is untouched', () => {
    const doc = new Y.Doc();
    setRating(doc, 's1', 'i1', 'S');
    appendPhoto(doc, 's1', 'i1', { key: 'r2/u.jpg' }, 'unit-1');
    const map = readResultMap(doc);
    expect((map[FK] as Record<string, unknown>).rating).toBe('S');
    expect((map[FK] as Record<string, unknown>).photos ?? []).toHaveLength(0);
    expect((map['unit-1:s1:i1'] as Record<string, unknown>).photos).toHaveLength(1);
  });

  it('a rating that exists only in the loader results survives an attach on an unsynced document', () => {
    const doc = new Y.Doc();
    // The document knows the item (the structure is always seeded) but holds no rating for it: it has not
    // synced with the server's copy, which is where the stored rating and notes live.
    seedResultsDoc(doc, [{ findingKey: FK }]);
    appendPhoto(doc, 's1', 'i1', { key: 'r2/c.jpg' });
    const loaderEntry = { rating: 'D', notes: 'Cracked flashing', photos: [{ key: 'r2/old.jpg' }] };
    const next = mergeUnsyncedResults({ [FK]: loaderEntry, i1: loaderEntry }, doc);
    const item = next[FK] as Record<string, unknown>;
    expect(item.rating).toBe('D');
    expect(item.notes).toBe('Cracked flashing');
    expect((item.photos as Array<{ key: string }>).map((p) => p.key)).toEqual(['r2/old.jpg', 'r2/c.jpg']);
    expect(next.i1).toBe(item);
  });
});
