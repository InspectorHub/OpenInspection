// @vitest-environment happy-dom
/**
 * The page state after a write to the client results document. Reproduces "Add photo clears notes and rating":
 * the loader's results are on the page, the client document has not synced (empty apart from local writes),
 * and attaching a photo used to replace the whole page state with the document's near-empty projection.
 */
import { act, cleanup, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { appendPhoto, setNotes, setRating } from '../collab/results-binding';
import type { ResultsDocHandle } from '../collab/use-results-doc';
import { seedResultsDoc } from '../shared/results-doc';
import type { ResultMap } from './useInspection';
import { useResultsProjection } from './useResultsProjection';

afterEach(cleanup);

const A = '_default:s1:i1';
const B = '_default:s1:i2';
const entry = (over: Record<string, unknown>) => over;
const LOADER: ResultMap = (() => {
  const a = entry({ rating: 'D', notes: 'Cracked flashing', photos: [{ key: 'r2/old.jpg' }] });
  const b = entry({ rating: 'S' });
  return { [A]: a, i1: a, [B]: b, i2: b } as ResultMap;
})();

function mount(synced: boolean) {
  const doc = new Y.Doc();
  seedResultsDoc(doc, [{ findingKey: A }]);
  const handle: ResultsDocHandle = { doc, persistenceSynced: true, synced };
  const hook = renderHook(() => {
    const [results, setResults] = useState<ResultMap>(LOADER);
    useResultsProjection(handle, setResults);
    return results;
  });
  return { doc, hook };
}
const at = (r: ResultMap, k: string) => r[k] as Record<string, unknown>;

describe('useResultsProjection', () => {
  it('REPRO: attaching a photo before the document has synced keeps every rating and note on the page', () => {
    const { doc, hook } = mount(false);
    act(() => appendPhoto(doc, 's1', 'i1', { key: 'r2/new.jpg' }));
    const r = hook.result.current;
    expect(at(r, A).rating).toBe('D');
    expect(at(r, A).notes).toBe('Cracked flashing');
    expect((at(r, A).photos as Array<{ key: string }>).map((p) => p.key)).toEqual(['r2/old.jpg', 'r2/new.jpg']);
    // Another finding the document knows nothing of is untouched.
    expect(at(r, B).rating).toBe('S');
    expect(r.i1).toBe(r[A]);
  });

  it('an edit made before the sync shows, and clearing a value clears it', () => {
    const { doc, hook } = mount(false);
    act(() => { setRating(doc, 's1', 'i1', 'NI'); setNotes(doc, 's1', 'i1', ''); });
    expect(at(hook.result.current, A).rating).toBe('NI');
    expect(at(hook.result.current, A).notes).toBeUndefined();
    expect(at(hook.result.current, B).rating).toBe('S');
  });

  it('once synced the document projection is adopted whole, so a collaborator deleting a finding arrives', () => {
    const { doc, hook } = mount(true);
    act(() => setRating(doc, 's1', 'i1', 'NI'));
    const r = hook.result.current;
    expect(at(r, A).rating).toBe('NI');
    // B is not in the (synced) document: it is gone from the page, as before.
    expect(r[B]).toBeUndefined();
  });
});
