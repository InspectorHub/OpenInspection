import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { seedResultsDoc, applyItemPatch, projectResults } from '../../../server/lib/collab/results-doc';

const FK = '_default:s1:i1';

describe('results-doc', () => {
  it('seeds a fully-formed item map (no lazy nested create later)', () => {
    const doc = new Y.Doc();
    seedResultsDoc(doc, [{ findingKey: FK }]);
    const item = doc.getMap('results').get(FK) as Y.Map<unknown>;
    expect(item).toBeInstanceOf(Y.Map);
    expect(item.get('attributes')).toBeInstanceOf(Y.Map);
    expect(item.get('photos')).toBeInstanceOf(Y.Array);
    expect((item.get('tabs') as Y.Map<unknown>).get('defects')).toBeInstanceOf(Y.Array);
  });

  it('seed is idempotent (re-seed does not clobber values)', () => {
    const doc = new Y.Doc();
    seedResultsDoc(doc, [{ findingKey: FK }]);
    applyItemPatch(doc, FK, 'rating', 'D');
    seedResultsDoc(doc, [{ findingKey: FK }]);
    expect((doc.getMap('results').get(FK) as Y.Map<unknown>).get('rating')).toBe('D');
  });

  it('projects to the legacy data shape', () => {
    const doc = new Y.Doc();
    seedResultsDoc(doc, [{ findingKey: FK }]);
    applyItemPatch(doc, FK, 'rating', 'D');
    applyItemPatch(doc, FK, 'notes', 'cracked');
    const proj = projectResults(doc);
    expect(proj[FK].rating).toBe('D');
    expect(proj[FK].notes).toBe('cracked');
    // empty optionals omitted (matches legacy blob)
    expect(proj[FK].photos ?? []).toEqual([]);
  });

  it('two concurrent docs editing different fields of a PRE-SEEDED item both survive a merge', () => {
    const a = new Y.Doc(); const b = new Y.Doc();
    seedResultsDoc(a, [{ findingKey: FK }]);
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a)); // share the seeded structure
    applyItemPatch(a, FK, 'rating', 'D');
    applyItemPatch(b, FK, 'notes', 'from-b');
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(projectResults(a)).toEqual(projectResults(b));
    expect(projectResults(a)[FK]).toMatchObject({ rating: 'D', notes: 'from-b' });
  });
});
