/**
 * A clip has no file key (its `key` is empty), so the merge of the loader's photos with the document's cannot
 * recognise one by key. A clip the loader already lists and the document also holds must show once, not twice.
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { appendPhoto, appendVideo } from './results-binding';
import { seedResultsDoc } from '../shared/results-doc';
import { mergeUnsyncedResults } from './results-merge';

const FK = '_default:s1:i1';
const r2 = (mediaId: string) => ({ key: '', mediaType: 'video' as const, provider: 'r2' as const, mediaId });
const ids = (item: unknown) => ((item as { photos: Array<{ key: string; mediaId?: string; streamUid?: string }> }).photos).map((p) => p.mediaId ?? p.streamUid ?? p.key);

describe('mergeUnsyncedResults with video clips', () => {
  it('shows a clip once when the loader and the document both hold it, and keeps the loader order', () => {
    const doc = new Y.Doc();
    seedResultsDoc(doc, [{ findingKey: FK }]);
    appendPhoto(doc, 's1', 'i1', { key: 'p1' });
    appendVideo(doc, 's1', 'i1', r2('m1'));
    appendVideo(doc, 's1', 'i1', { key: '', mediaType: 'video', provider: 'stream', streamUid: 'u1' });
    const loader = { photos: [{ key: 'p1' }, r2('m1'), { key: '', mediaType: 'video', provider: 'stream', streamUid: 'u1' }] };
    const next = mergeUnsyncedResults({ [FK]: loader }, doc);
    expect(ids(next[FK])).toEqual(['p1', 'm1', 'u1']);
  });

  it('control: a clip only the loader has, and one only the document has, both stay', () => {
    const doc = new Y.Doc();
    seedResultsDoc(doc, [{ findingKey: FK }]);
    appendVideo(doc, 's1', 'i1', r2('m2'));
    const next = mergeUnsyncedResults({ [FK]: { photos: [r2('m1')] } }, doc);
    expect(ids(next[FK]).sort()).toEqual(['m1', 'm2']);
  });

  it('also holds for legacy Stream clips that carry a streamUid and no provider', () => {
    const doc = new Y.Doc();
    seedResultsDoc(doc, [{ findingKey: FK }]);
    appendPhoto(doc, 's1', 'i1', { key: 'p1' });
    appendVideo(doc, 's1', 'i1', { key: '', mediaType: 'video', streamUid: 'u1' } as never);
    appendVideo(doc, 's1', 'i1', { key: '', mediaType: 'video', streamUid: 'u2' } as never);
    const loader = { photos: [{ key: 'p1' }, { key: '', mediaType: 'video', streamUid: 'u1' }, { key: '', mediaType: 'video', streamUid: 'u2' }] };
    expect(ids(mergeUnsyncedResults({ [FK]: loader }, doc)[FK])).toEqual(['p1', 'u1', 'u2']);
  });
});
