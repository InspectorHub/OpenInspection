import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { mediaRef } from '@core/field-ui/shared/media-ref';
import { appendVideo, loadResultsProjection, projectResults, reorderPhotos, seedResultsDoc, appendPhoto } from '@core/field-ui/shared/results-doc';
import { mergeUnsyncedResults } from '@core/field-ui/collab/results-merge';

const FK = '_default:s1:i1';
const both = { key: '', mediaType: 'video' as const, provider: 'r2' as const, mediaId: 'm1', streamUid: 'u1' };

describe('one identity order everywhere: key, then media id, then stream uid, then pending id', () => {
  it('mediaRef names an entry carrying both ids by its media id', () => {
    expect(mediaRef(both)).toBe('m:m1');
    expect(mediaRef({ key: '', streamUid: 'u1' })).toBe('s:u1');
    expect(mediaRef({ key: '', pendingId: 'p1' })).toBe('p:p1');
    expect(mediaRef({ key: 'k', mediaId: 'm1' })).toBe('k');
    expect(mediaRef({ key: '' })).toBe('');
  });

  it('appendVideo upserts an entry carrying both ids by its media id', () => {
    const doc = new Y.Doc();
    seedResultsDoc(doc, [{ findingKey: FK }]);
    appendVideo(doc, FK, both as never);
    appendVideo(doc, FK, { ...both, streamUid: 'other' } as never); // same media id: the same clip
    appendVideo(doc, FK, { ...both, mediaId: 'm2' } as never); // same stream uid, different media id: a different clip
    expect((projectResults(doc)[FK].photos ?? []).map((p) => p.mediaId)).toEqual(['m1', 'm2']);
  });

  it('the merge with the loader recognises an entry carrying both ids by the same name', () => {
    const doc = new Y.Doc();
    seedResultsDoc(doc, [{ findingKey: FK }]);
    appendVideo(doc, FK, both as never);
    const merged = mergeUnsyncedResults({ [FK]: { photos: [both] } }, doc)[FK] as { photos: unknown[] };
    expect(merged.photos).toHaveLength(1);
  });
});

describe('a reorder is refused (no-op) when any entry has no name at all', () => {
  it('reorderPhotos leaves the array alone, and every entry stays', () => {
    const doc = new Y.Doc();
    seedResultsDoc(doc, [{ findingKey: FK }]);
    appendPhoto(doc, FK, { key: 'a' });
    appendPhoto(doc, FK, { key: 'b' });
    loadResultsProjection(doc, { [FK]: { photos: [{ key: '', caption: 'nameless' } as never] } });
    const before = JSON.stringify(projectResults(doc)[FK].photos);
    reorderPhotos(doc, FK, ['b', 'a']);
    expect(JSON.stringify(projectResults(doc)[FK].photos)).toBe(before);
  });
});

describe('loadResultsProjection skips a video that has neither identity nor key (silently: the module has no logger)', () => {
  it('keeps the photos that are there and adds nothing', () => {
    const doc = new Y.Doc();
    loadResultsProjection(doc, { [FK]: { photos: [{ key: 'a' }, { key: '', mediaType: 'video' }] } });
    expect(projectResults(doc)[FK].photos).toEqual([{ key: 'a' }]);
  });
});
