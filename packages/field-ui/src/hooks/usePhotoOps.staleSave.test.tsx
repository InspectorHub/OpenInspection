// @vitest-environment happy-dom
/**
 * A studio or cropper opened on photo B keeps saving onto photo B when the item's photo list changes while it is open
 * (another device inserts, deletes or reorders). The save used to re-read the entry at the remembered INDEX, so it
 * wrote onto whichever photo had moved into that slot. Now the dialog carries the original key it was opened on and
 * the save finds that entry again; if it is gone nothing is written, the person is told, and the dialog stays open.
 */
import { createElement, type ReactNode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { FieldDataSourceProvider } from '../context';
import { m } from '../i18n';
import type { MediaUploader, PendingMediaRecord } from '../media-types';
import type { PhotoEntry } from '../shared/results-doc.types';
import { appendPhoto, projectResults, removePhoto, reorderPhotos, seedResultsDoc } from '../shared/results-doc';
import { createEmptyEditorData, createFakeDataSource, type FakeDataSource } from '../testing/fake-data-source';
import { usePhotoOps } from './usePhotoOps';

afterEach(cleanup);

const FK = '_default:s1:i1';
const PIXELS = { x: 1, y: 2, width: 30, height: 20 };
const CROP = { aspect: '3:2', orientation: 'landscape' as const, pixels: PIXELS };
const blob = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' });
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });

function setup() {
  const ds = createFakeDataSource({ data: createEmptyEditorData() });
  const doc = new Y.Doc();
  seedResultsDoc(doc, [{ findingKey: FK }]);
  appendPhoto(doc, FK, { key: 'A.jpg', mediaType: 'photo' });
  appendPhoto(doc, FK, { key: 'B.jpg', mediaType: 'photo' });
  const state = {
    inspection: { id: 'insp1', coverPhotoId: null },
    sections: [], results: {}, currentSection: undefined,
    sectionIdForItem: () => 's1', setResults: vi.fn(), setDirty: vi.fn(), setInspection: vi.fn(),
  };
  // The live document, read at call time like the editor's own findings reader.
  const findings = { getResult: () => ({ photos: projectResults(doc)[FK]?.photos ?? [] }) };
  const ctx = {
    state, findings, streamCustomerSubdomain: null, collabDoc: doc, activeUnitId: null,
    setPhotoStudioUrl: vi.fn(), setPhotoStudioKey: vi.fn(), setPhotoStudioIndex: vi.fn(), setPhotoStudioTotal: vi.fn(), setPhotoStudioOpen: vi.fn(),
  };
  const wrapper = ({ children }: { children: ReactNode }) => createElement(FieldDataSourceProvider, { dataSource: ds }, children);
  const hook = renderHook(() => usePhotoOps(ctx as never), { wrapper });
  return { ds, doc, hook, findings };
}

// The dialog was opened on B, which was at index 1.
const target = { itemId: 'i1', photoIndex: 1, sectionId: 's1', expectOriginalKey: 'B.jpg' };
const mutations: Array<[string, (doc: Y.Doc) => void, number]> = [
  ['a photo is inserted before it', (d) => { appendPhoto(d, FK, { key: 'X.jpg', mediaType: 'photo' }); reorderPhotos(d, FK, ['X.jpg', 'A.jpg', 'B.jpg']); }, 2],
  ['the photo before it is deleted', (d) => removePhoto(d, FK, 'A.jpg'), 0],
  ['the two photos are reordered', (d) => reorderPhotos(d, FK, ['B.jpg', 'A.jpg']), 0],
];

describe.each(mutations)('the list changes while the dialog is open: %s', (_name, mutate, nowAt) => {
  it('an annotation still addresses B (its key and its current index)', async () => {
    const { ds, hook, doc } = setup();
    mutate(doc);
    act(() => { hook.result.current.performPhotoAnnotationSave(target, blob(), '[]'); });
    await flush();
    const rec = ds.uploads.at(-1)?.rec;
    expect(rec?.kind === 'annotate' && rec.meta).toMatchObject({ photoKey: 'B.jpg', photoIndex: nowAt });
  });

  it('a crop still addresses B (its key and its current index)', async () => {
    const { ds, hook, doc } = setup();
    mutate(doc);
    act(() => hook.result.current.performPhotoCropSave(target, blob(), CROP));
    await flush();
    const rec = ds.uploads.at(-1)?.rec;
    expect(rec?.kind === 'crop' && rec.meta).toMatchObject({ photoKey: 'B.jpg', photoIndex: nowAt });
  });
});

describe('the photo the dialog was opened on is gone', () => {
  // The dialog stays OPEN (the person may have drawn for a while: they decide when to close it) and is told why.
  it('an annotation writes nothing, tells the person and asks to keep the studio open', async () => {
    const { ds, hook, doc } = setup();
    removePhoto(doc, FK, 'B.jpg');
    const answers: boolean[] = [];
    act(() => { hook.result.current.performPhotoAnnotationSave(target, blob(), '[]', (mayClose) => { answers.push(mayClose); }); });
    await flush();
    expect(ds.uploads).toEqual([]);
    expect(ds.notifications.map((n) => n.message)).toEqual([m.editor_photo_save_gone_keep_open()]);
    expect(answers).toEqual([false]);
  });

  it('a crop writes nothing, tells the person and asks to keep the cropper open', async () => {
    const { ds, hook, doc } = setup();
    removePhoto(doc, FK, 'B.jpg');
    const answers: boolean[] = [];
    act(() => hook.result.current.performPhotoCropSave(target, blob(), CROP, (mayClose) => { answers.push(mayClose); }));
    await flush();
    expect(ds.uploads).toEqual([]);
    expect(ds.notifications.map((n) => n.message)).toEqual([m.editor_photo_save_gone_keep_open()]);
    expect(answers).toEqual([false]);
  });

  it('without an expected key (an older caller) an unaddressable index still closes, as before', async () => {
    const { ds, hook } = setup();
    const answers: boolean[] = [];
    act(() => { hook.result.current.performPhotoAnnotationSave({ itemId: 'i1', photoIndex: 9, sectionId: 's1' }, blob(), '[]', (mayClose) => { answers.push(mayClose); }); });
    await flush();
    expect(ds.notifications.map((n) => n.message)).toEqual([m.editor_photo_save_no_photo()]);
    expect(answers).toEqual([true]);
  });

  it('without an expected key (an older caller) the index still decides', async () => {
    const { ds, hook } = setup();
    act(() => { hook.result.current.performPhotoAnnotationSave({ itemId: 'i1', photoIndex: 0, sectionId: 's1' }, blob(), '[]'); });
    await flush();
    const rec = ds.uploads.at(-1)?.rec;
    expect(rec?.kind === 'annotate' && rec.meta).toMatchObject({ photoKey: 'A.jpg', photoIndex: 0 });
  });
});

describe('a save with no dialog to keep open, or whose photo vanishes during the image check', () => {
  // The re-crop warning confirms AFTER the cropper closed and calls the save with no `onChecked`: there is no dialog
  // to say "Close this window" to, so the plain sentence is used.
  it('a crop run from the re-crop warning, photo gone: the plain not-found sentence', async () => {
    const { ds, hook, doc } = setup();
    removePhoto(doc, FK, 'B.jpg');
    act(() => hook.result.current.performPhotoCropSave(target, blob(), CROP));
    await flush();
    expect(ds.uploads).toEqual([]);
    expect(ds.notifications.map((n) => n.message)).toEqual([m.editor_photo_save_no_photo()]);
  });

  // The image check is asynchronous; the dialog was already told it may close, so a photo that vanishes meanwhile must
  // still be reported rather than dropped without a word.
  it('an annotation whose photo vanishes during the image check says so and writes nothing', async () => {
    const { ds, hook, doc } = setup();
    hook.result.current.performPhotoAnnotationSave(target, blob(), '[]');
    removePhoto(doc, FK, 'B.jpg');
    await flush();
    expect(ds.uploads).toEqual([]);
    expect(ds.notifications.map((n) => n.message)).toEqual([m.editor_photo_save_no_photo()]);
  });

  it('a crop whose photo vanishes during the image check says so and writes nothing', async () => {
    const { ds, hook, doc } = setup();
    hook.result.current.performPhotoCropSave(target, blob(), CROP);
    removePhoto(doc, FK, 'B.jpg');
    await flush();
    expect(ds.uploads).toEqual([]);
    expect(ds.notifications.map((n) => n.message)).toEqual([m.editor_photo_save_no_photo()]);
  });
});

/** An uploader whose answers the test settles by hand, in the order it likes. */
function heldUploader(ds: FakeDataSource) {
  const calls: PendingMediaRecord[] = [];
  const releases: Array<(r: { ok: true; key: string } | { ok: false; error: string }) => void> = [];
  ds.media.uploader = (): MediaUploader => ({
    upload: (rec) => {
      calls.push(rec);
      return new Promise((resolve) => releases.push(resolve));
    },
  });
  return { calls, releases };
}
const entries = (doc: Y.Doc) => (projectResults(doc)[FK]?.photos ?? []) as PhotoEntry[];
const settle = (release: (r: { ok: true; key: string }) => void, key: string) => act(async () => { release({ ok: true, key }); await new Promise((r) => setTimeout(r, 5)); });

describe('an annotation and a crop of the same photo in flight together', () => {
  it('both records address the same original key, and a crop that lands last clears the annotation (by design)', async () => {
    const { ds, hook, doc } = setup();
    const held = heldUploader(ds);
    act(() => { hook.result.current.performPhotoAnnotationSave(target, blob(), '[{"t":"rect"}]'); });
    act(() => hook.result.current.performPhotoCropSave(target, blob(), CROP));
    await flush();
    expect(held.calls.map((c) => c.kind).sort()).toEqual(['annotate', 'crop']);
    for (const c of held.calls) expect(c.kind === 'annotate' || c.kind === 'crop' ? c.meta : null).toMatchObject({ photoKey: 'B.jpg', photoIndex: 1 });
    const annotateAt = held.calls.findIndex((c) => c.kind === 'annotate');
    const cropAt = held.calls.findIndex((c) => c.kind === 'crop');
    await settle(held.releases[annotateAt]!, 'ann-1.png');
    expect(entries(doc)[1]).toMatchObject({ key: 'B.jpg', annotatedKey: 'ann-1.png' });
    await settle(held.releases[cropAt]!, 'crop-1.jpg');
    // The crop re-derives from the original and drops an annotation drawn on the old frame.
    expect(entries(doc)[1]).toMatchObject({ key: 'B.jpg', croppedKey: 'crop-1.jpg' });
    expect(entries(doc)[1]).not.toHaveProperty('annotatedKey');
    expect(entries(doc)).toHaveLength(2);
    expect(entries(doc)[0]).toMatchObject({ key: 'A.jpg' });
  });

  it('whichever lands first, the photo stays one entry under its own key and the neighbour is untouched', async () => {
    const { ds, hook, doc } = setup();
    const held = heldUploader(ds);
    act(() => { hook.result.current.performPhotoAnnotationSave(target, blob(), '[]'); });
    act(() => hook.result.current.performPhotoCropSave(target, blob(), CROP));
    await flush();
    const annotateAt = held.calls.findIndex((c) => c.kind === 'annotate');
    const cropAt = held.calls.findIndex((c) => c.kind === 'crop');
    await settle(held.releases[cropAt]!, 'crop-1.jpg');
    await settle(held.releases[annotateAt]!, 'ann-1.png');
    expect(entries(doc)).toHaveLength(2);
    expect(entries(doc)[1]).toMatchObject({ key: 'B.jpg', croppedKey: 'crop-1.jpg' });
    expect(entries(doc)[0]).toEqual({ key: 'A.jpg', mediaType: 'photo' });
  });
});

describe('a list with the same key twice', () => {
  // The results document never holds two entries under one key, but a reader may briefly show one (a merge in flight).
  it('the first match wins, consistently between the record index and the document write', async () => {
    const { ds, hook, doc, findings } = setup();
    findings.getResult = () => ({ photos: [{ key: 'A.jpg' }, { key: 'B.jpg' }, { key: 'A.jpg' }] });
    act(() => { hook.result.current.performPhotoAnnotationSave({ itemId: 'i1', photoIndex: 2, sectionId: 's1', expectOriginalKey: 'A.jpg' }, blob(), '[]'); });
    await flush();
    const rec = ds.uploads.at(-1)?.rec;
    expect(rec?.kind === 'annotate' && rec.meta).toMatchObject({ photoKey: 'A.jpg', photoIndex: 0 });
    expect(entries(doc).map((e) => 'annotatedKey' in e)).toEqual([true, false]);
  });
});
