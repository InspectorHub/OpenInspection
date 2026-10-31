// @vitest-environment happy-dom
/**
 * A crop or an annotation reads the whole image before it is saved. The photo is found again BY KEY when that wait
 * ends: removed meanwhile means nothing is written, moved means the right photo is patched, not the one now at the
 * old index.
 */
import { createElement, type ReactNode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { FieldDataSourceProvider } from '../context';
import { appendPhoto, projectResults, seedResultsDoc } from '../shared/results-doc';
import { createEmptyEditorData, createFakeDataSource } from '../testing/fake-data-source';
import { usePhotoOps } from './usePhotoOps';

afterEach(cleanup);

const FK = '_default:s1:i1';
const CROP = { aspect: '3:2', orientation: 'landscape' as const, pixels: { x: 1, y: 2, width: 30, height: 20 } };
const target = { itemId: 'i1', photoIndex: 0, sectionId: 's1' };
const jpeg = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' });
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });

function setup() {
  const ds = createFakeDataSource({ data: createEmptyEditorData() });
  const doc = new Y.Doc();
  seedResultsDoc(doc, [{ findingKey: FK }]);
  appendPhoto(doc, FK, { key: 'base.jpg', mediaType: 'photo' });
  const setResults = vi.fn();
  type Photos = Array<{ key: string }>;
  // The reader the editor hands the hook is rebuilt when the photos change, as in the app: each render gets a NEW
  // `findings` object, so the hook only sees a change if it reads its latest render's reader.
  const ctxFor = (photos: Photos) => ({
    state: {
      inspection: { id: 'insp1', coverPhotoId: null }, sections: [], results: {}, currentSection: undefined,
      sectionIdForItem: (itemId: string) => (itemId === 'i1' ? 's1' : null), setResults, setDirty: vi.fn(),
    },
    findings: { getResult: () => ({ photos }) },
    streamCustomerSubdomain: null, collabDoc: doc, activeUnitId: null,
    setPhotoStudioUrl: vi.fn(), setPhotoStudioKey: vi.fn(), setPhotoStudioIndex: vi.fn(), setPhotoStudioTotal: vi.fn(), setPhotoStudioOpen: vi.fn(),
  });
  const wrapper = ({ children }: { children: ReactNode }) => createElement(FieldDataSourceProvider, { dataSource: ds }, children);
  const hook = renderHook(({ photos }: { photos: Photos }) => usePhotoOps(ctxFor(photos) as unknown as Parameters<typeof usePhotoOps>[0]), {
    wrapper,
    initialProps: { photos: [{ key: 'base.jpg' }] as Photos },
  });
  // Changes what the editor shows and renders again, which is what hands the hook its new reader.
  const setPhotos = (next: Photos) => act(() => hook.rerender({ photos: next }));
  return { ds, doc, setResults, hook, setPhotos };
}

describe('crop save: the photo is removed while the image is checked', () => {
  it('writes nothing, uploads nothing, and the photo can be saved again once it is back', async () => {
    const { ds, doc, setResults, hook, setPhotos } = setup();
    act(() => hook.result.current.performPhotoCropSave(target, jpeg(), CROP));
    await setPhotos([]);
    await flush();
    expect(setResults).not.toHaveBeenCalled();
    expect(ds.uploads).toHaveLength(0);
    expect((projectResults(doc)[FK]?.photos?.[0] as unknown as Record<string, unknown>)?.croppedKey).toBeUndefined();
    await setPhotos([{ key: 'base.jpg' }]);
    act(() => hook.result.current.performPhotoCropSave(target, jpeg(), CROP));
    await flush();
    expect(ds.uploads).toHaveLength(1);
  });

  it('CONTROL - a photo that stays is patched and uploaded as before', async () => {
    const { ds, setResults, hook } = setup();
    act(() => hook.result.current.performPhotoCropSave(target, jpeg(), CROP));
    await flush();
    expect(setResults).toHaveBeenCalledTimes(1);
    expect(ds.uploads).toHaveLength(1);
  });

  it('a photo moved to another index is the one patched, not the photo now at the old index', async () => {
    const { setResults, hook, setPhotos } = setup();
    act(() => hook.result.current.performPhotoCropSave(target, jpeg(), CROP));
    await setPhotos([{ key: 'other.jpg' }, { key: 'base.jpg' }]);
    await flush();
    const updater = setResults.mock.calls[0]![0] as (prev: Record<string, unknown>) => Record<string, { photos: Array<Record<string, unknown>> }>;
    const out = updater({ i1: { photos: [{ key: 'other.jpg' }, { key: 'base.jpg' }] } });
    const photos = out.i1!.photos;
    expect(photos[0]).toEqual({ key: 'other.jpg' });
    expect(photos[1]!.crop).toBeTruthy();
  });
});

describe('annotation save: the photo is removed while the image is checked', () => {
  it('queues nothing, uploads nothing and writes nothing', async () => {
    const { ds, doc, hook, setPhotos } = setup();
    act(() => { hook.result.current.performPhotoAnnotationSave(target, jpeg(), '[{"t":"rect"}]'); });
    await setPhotos([]);
    await flush();
    expect(ds.uploads).toHaveLength(0);
    expect((projectResults(doc)[FK]?.photos?.[0] as unknown as Record<string, unknown>)?.annotatedKey).toBeUndefined();
  });

  it('CONTROL - a photo that stays is annotated as before', async () => {
    const { ds, hook } = setup();
    act(() => { hook.result.current.performPhotoAnnotationSave(target, jpeg(), '[{"t":"rect"}]'); });
    await flush();
    expect(ds.uploads).toHaveLength(1);
  });
});
