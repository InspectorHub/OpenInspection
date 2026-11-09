// @vitest-environment happy-dom
/**
 * The report cover names a photo by the key it shows. A crop or annotation baked again gets a NEW key, so when the cover
 * pointed at the file the photo showed until now it moves to the new one here as well as on the server; otherwise the
 * studio would call the cover "not the cover" and the saved cover crop could not be found. A cover on another photo is
 * left alone. An annotation keeps the frame, so the saved cover crop stays; a crop changes the frame, so it is dropped.
 */
import { createElement, type ReactNode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { FieldDataSourceProvider } from '../context';
import { appendPhoto, projectResults, seedResultsDoc } from '../shared/results-doc';
import { createEmptyEditorData, createFakeDataSource } from '../testing/fake-data-source';
import { coverCropFor } from '../components/media-studio/CoverCropper';
import { usePhotoOps } from './usePhotoOps';

afterEach(cleanup);

const FK = '_default:s1:i1';
type Insp = { id: string; coverPhotoId: string | null; coverCrop: object | null; coverImageKey: string | null };
const CROP = { aspect: '3:2', orientation: 'landscape' as const, pixels: { x: 1, y: 2, width: 30, height: 20 } };
const COVER_CROP = { aspect: '3:2', orientation: 'landscape', x: 5, y: 6, width: 70, height: 40 };
const blob = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' });
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });

function setup(cover: string | null) {
  const ds = createFakeDataSource({ data: createEmptyEditorData() });
  const doc = new Y.Doc();
  seedResultsDoc(doc, [{ findingKey: FK }]);
  appendPhoto(doc, FK, { key: 'A.jpg', mediaType: 'photo' });
  appendPhoto(doc, FK, { key: 'B.jpg', mediaType: 'photo', annotatedKey: 'B-old.png' });
  let inspection: Insp = { id: 'insp1', coverPhotoId: cover, coverCrop: COVER_CROP, coverImageKey: 'baked-cover.jpg' };
  const setInspection = vi.fn((fn: (prev: Insp) => Insp) => { inspection = fn(inspection); });
  const state = {
    get inspection() { return inspection; },
    setInspection,
    sections: [], results: {}, currentSection: undefined,
    sectionIdForItem: () => 's1', setResults: vi.fn(), setDirty: vi.fn(),
  };
  const findings = { getResult: () => ({ photos: projectResults(doc)[FK]?.photos ?? [] }) };
  const ctx = {
    state, findings, streamCustomerSubdomain: null, collabDoc: doc, activeUnitId: null,
    setPhotoStudioUrl: vi.fn(), setPhotoStudioKey: vi.fn(), setPhotoStudioIndex: vi.fn(), setPhotoStudioTotal: vi.fn(), setPhotoStudioOpen: vi.fn(),
  };
  const wrapper = ({ children }: { children: ReactNode }) => createElement(FieldDataSourceProvider, { dataSource: ds }, children);
  const hook = renderHook(() => usePhotoOps(ctx as never), { wrapper });
  return { ds, hook, get: () => inspection };
}

const annotateB = { itemId: 'i1', photoIndex: 1, sectionId: 's1', expectOriginalKey: 'B.jpg' };

describe('the cover follows its photo when the photo is baked again', () => {
  it('annotation: a cover on the photo moves to the new file, keeps its saved crop, and the cropper still finds it', async () => {
    const { ds, hook, get } = setup('B-old.png');
    act(() => { hook.result.current.performPhotoAnnotationSave(annotateB, blob(), '[]'); });
    await flush();
    const key = ds.uploads.at(-1) ? `uploaded/${ds.uploads.at(-1)!.rec.pendingId}` : '';
    expect(get().coverPhotoId).toBe(key);
    expect(get().coverCrop).toEqual(COVER_CROP);
    // The baked cover file was cut before the strokes, so it goes (the cover shows the annotated photo); the frame is
    // unchanged, so the saved rectangle stays and "Adjust cover" reopens on it.
    expect(get().coverImageKey).toBeNull();
    expect(coverCropFor(get(), key)).not.toBeNull();
  });

  it('crop: a cover on the photo moves to the new file and drops the saved cover crop (its frame changed)', async () => {
    const { ds, hook, get } = setup('B-old.png');
    act(() => hook.result.current.performPhotoCropSave({ ...annotateB }, blob(), CROP));
    await flush();
    expect(get().coverPhotoId).toBe(`uploaded/${ds.uploads.at(-1)!.rec.pendingId}`);
    expect(get().coverCrop).toBeNull();
    // The report prefers the baked file, which was cut from the old frame: it goes too, and the cover is the new photo.
    expect(get().coverImageKey).toBeNull();
  });

  it('a cover on another photo, or none, is left alone', async () => {
    const other = setup('A.jpg');
    act(() => { other.hook.result.current.performPhotoAnnotationSave(annotateB, blob(), '[]'); });
    await flush();
    expect(other.get().coverPhotoId).toBe('A.jpg');
    expect(other.get().coverCrop).toEqual(COVER_CROP);
    expect(other.get().coverImageKey).toBe('baked-cover.jpg');
    const none = setup(null);
    act(() => none.hook.result.current.performPhotoCropSave({ ...annotateB }, blob(), CROP));
    await flush();
    expect(none.get().coverPhotoId).toBeNull();
  });

  it('a save that fails moves nothing', async () => {
    const { ds, hook, get } = setup('B-old.png');
    ds.failUpload('HTTP_500');
    act(() => { hook.result.current.performPhotoAnnotationSave(annotateB, blob(), '[]'); });
    await flush();
    expect(get().coverPhotoId).toBe('B-old.png');
  });

  it('the cover crop the session saved follows too: re-keyed by an annotation, dropped by a crop', async () => {
    const a = setup('B-old.png');
    act(() => a.hook.result.current.setSessionCoverCrop({ key: 'B-old.png', crop: { aspect: '3:2', orientation: 'landscape', x: 1, y: 1, width: 2, height: 2 } }));
    act(() => { a.hook.result.current.performPhotoAnnotationSave(annotateB, blob(), '[]'); });
    await flush();
    expect(a.hook.result.current.sessionCoverCrop?.key).toBe(a.get().coverPhotoId);

    const c = setup('B-old.png');
    act(() => c.hook.result.current.setSessionCoverCrop({ key: 'B-old.png', crop: { aspect: '3:2', orientation: 'landscape', x: 1, y: 1, width: 2, height: 2 } }));
    act(() => c.hook.result.current.performPhotoCropSave({ ...annotateB }, blob(), CROP));
    await flush();
    expect(c.hook.result.current.sessionCoverCrop).toBeNull();
  });
});
