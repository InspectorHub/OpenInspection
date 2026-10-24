// @vitest-environment happy-dom
/**
 * Baking a crop or an annotation from the photo viewer, through the data source.
 *
 * The hook used to POST straight to `/api/inspections/:id/items/:item/photos/:index/crop|annotation`
 * and to read `navigator.onLine` and the web media store itself. It now goes through
 * `media.uploader(...).upload`, `media.store` and `isOnline`, so these tests drive a fake data
 * source. What they pin is what the editor saw before:
 *  - online: the baked key lands in the results document, nothing else happens (no toast);
 *  - offline: the blob is queued and the doc photo is marked pending, the base key is kept;
 *  - a failed online bake changes nothing and says nothing;
 *  - a repeat while the first save is still in flight sends nothing (same frame included) and says so;
 *  - a save that cannot be addressed or has no live document sends nothing, shows nothing as saved and says so;
 *  - the viewer / studio urls come from `urls.photo`.
 */
import { createElement, type ReactNode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { FieldDataSourceProvider } from '../context';
import type { MediaUploader, PendingMediaRecord } from '../media-types';
import { appendPhoto, projectResults, seedResultsDoc } from '../shared/results-doc';
import { createEmptyEditorData, createFakeDataSource, type FakeDataSource } from '../testing/fake-data-source';
import { usePhotoOps } from './usePhotoOps';

afterEach(cleanup);

const FK = '_default:s1:i1';
const PIXELS = { x: 1, y: 2, width: 30, height: 20 };
const CROP = { aspect: '3:2', orientation: 'landscape' as const, pixels: PIXELS };
const TRANSFORM = { aspect: '3:2', orientation: 'landscape', ...PIXELS };

function setup(opts: { withDoc?: boolean } = {}) {
  const ds = createFakeDataSource({
    data: createEmptyEditorData(),
    urls: { photo: (id, key) => `/photo-url/${id}/${key}` },
  });
  const doc = opts.withDoc === false ? null : new Y.Doc();
  if (doc) {
    seedResultsDoc(doc, [{ findingKey: FK }]);
    appendPhoto(doc, FK, { key: 'base.jpg', mediaType: 'photo' });
  }
  const state = {
    inspection: { id: 'insp1', coverPhotoId: null },
    sections: [],
    results: {},
    currentSection: undefined,
    sectionIdForItem: (itemId: string) => (itemId === 'i1' ? 's1' : null),
    setResults: vi.fn(),
    setDirty: vi.fn(),
  };
  const findings = { getResult: () => ({ photos: [{ key: 'base.jpg' }] }) };
  const ctx = {
    state,
    findings,
    streamCustomerSubdomain: null,
    collabDoc: doc,
    activeUnitId: null,
    setPhotoStudioUrl: vi.fn(),
    setPhotoStudioKey: vi.fn(),
    setPhotoStudioIndex: vi.fn(),
    setPhotoStudioTotal: vi.fn(),
    setPhotoStudioOpen: vi.fn(),
  };
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(FieldDataSourceProvider, { dataSource: ds }, children);
  const hook = renderHook(() => usePhotoOps(ctx as unknown as Parameters<typeof usePhotoOps>[0]), { wrapper });
  return { ds, doc, ctx, hook };
}

const photoOf = (doc: Y.Doc) => (projectResults(doc)[FK]?.photos ?? [])[0] as unknown as Record<string, unknown>;
const target = { itemId: 'i1', photoIndex: 0, sectionId: 's1' };
const blob = () => new Blob(['x'], { type: 'image/jpeg' });
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });

/** An uploader whose answers the test settles by hand. */
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

describe('online crop', () => {
  it('uploads the baked crop through the data source and mirrors croppedKey into the doc', async () => {
    const { ds, doc, hook } = setup();
    act(() => hook.result.current.performPhotoCropSave(target, blob(), CROP));
    await flush();
    expect(ds.uploads).toHaveLength(1);
    const up = ds.uploads[0]!;
    expect(up.inspectionId).toBe('insp1');
    expect(up.hadDoc).toBe(true);
    expect(up.rec.kind).toBe('crop');
    expect(up.rec.kind === 'crop' && up.rec.meta).toMatchObject({
      findingKey: FK, itemId: 'i1', photoIndex: 0, photoKey: 'base.jpg', crop: TRANSFORM, sectionId: 's1',
    });
    expect(photoOf(doc!)).toMatchObject({ key: 'base.jpg', croppedKey: `uploaded/${up.rec.pendingId}`, crop: TRANSFORM });
    expect(ds.notifications).toEqual([]);
    expect(await ds.media.store.list()).toEqual([]);
  });

  it('applies the optimistic edit at once, and a failed bake leaves the doc and the user alone', async () => {
    const { ds, doc, hook, ctx } = setup();
    ds.failUpload('HTTP_500');
    act(() => hook.result.current.performPhotoCropSave(target, blob(), CROP));
    expect(ctx.state.setResults).toHaveBeenCalledTimes(1);
    await flush();
    expect(photoOf(doc!)).toEqual({ key: 'base.jpg', mediaType: 'photo' });
    expect(ds.notifications).toEqual([]);
  });

  it('omits sectionId from the record when the target has none', async () => {
    const { ds, hook } = setup();
    act(() => hook.result.current.performPhotoCropSave({ itemId: 'i1', photoIndex: 0 }, blob(), CROP));
    await flush();
    // The section is then resolved from the item, so the finding key is the same one.
    const rec = ds.uploads[0]!.rec;
    expect(rec.kind === 'crop' && 'sectionId' in rec.meta).toBe(false);
  });

  it('sends one upload for two saves of the same photo in one frame, then accepts a later one', async () => {
    const { ds, hook, ctx } = setup();
    const held = heldUploader(ds);
    act(() => {
      hook.result.current.performPhotoCropSave(target, blob(), CROP);
      hook.result.current.performPhotoCropSave(target, blob(), CROP);
    });
    expect(held.calls).toHaveLength(1);
    // The dropped repeat did not apply a second optimistic edit either, and the user was told.
    expect(ctx.state.setResults).toHaveBeenCalledTimes(1);
    expect(ds.notifications).toHaveLength(1);
    expect(ds.notifications[0]).toMatchObject({ variant: 'info' });
    expect(ds.notifications[0]!.message).toMatch(/still saving/i);
    // A different photo is not held back by it.
    ctx.findings.getResult = () => ({ photos: [{ key: 'base.jpg' }, { key: 'other.jpg' }] });
    hook.rerender();
    act(() => hook.result.current.performPhotoCropSave({ ...target, photoIndex: 1 }, blob(), CROP));
    expect(held.calls).toHaveLength(2);
    await act(async () => { held.releases[0]!({ ok: false, error: 'x' }); held.releases[1]!({ ok: false, error: 'x' }); });
    await flush();
    act(() => hook.result.current.performPhotoCropSave(target, blob(), CROP));
    expect(held.calls).toHaveLength(3);
  });

  it('sends nothing, shows no optimistic crop and says so when the photo is not at that index (no key to address)', async () => {
    const { ds, hook, ctx } = setup();
    act(() => hook.result.current.performPhotoCropSave({ ...target, photoIndex: 5 }, blob(), CROP));
    await flush();
    expect(ds.uploads).toEqual([]);
    expect(await ds.media.store.list()).toEqual([]);
    expect(ctx.state.setResults).not.toHaveBeenCalled();
    expect(ds.notifications).toHaveLength(1);
    expect(ds.notifications[0]).toMatchObject({ variant: 'error' });
    expect(ds.notifications[0]!.message).toMatch(/cannot be found/i);
    expect(ds.notifications[0]!.message).not.toMatch(/not connected/i);
  });

  it('online without a live results document: nothing is sent or shown as cropped, and the user is told', async () => {
    const { ds, hook, ctx } = setup({ withDoc: false });
    act(() => hook.result.current.performPhotoCropSave(target, blob(), CROP));
    await flush();
    expect(ds.uploads).toEqual([]);
    expect(ctx.state.setResults).not.toHaveBeenCalled();
    expect(ds.notifications).toHaveLength(1);
    expect(ds.notifications[0]).toMatchObject({ variant: 'error' });
    expect(ds.notifications[0]!.message).toMatch(/not connected/i);
    expect(ds.notifications[0]!.message).not.toMatch(/cannot be found/i);
  });
});

describe('offline crop', () => {
  it('queues the blob and marks the doc photo pending, keeping the base key; nothing is uploaded', async () => {
    const { ds, doc, hook } = setup();
    ds.setOnline(false);
    act(() => hook.result.current.performPhotoCropSave(target, blob(), CROP));
    await flush();
    expect(ds.uploads).toEqual([]);
    const queued = await ds.media.store.list('insp1');
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ kind: 'crop', inspectionId: 'insp1' });
    expect(photoOf(doc!)).toMatchObject({ key: 'base.jpg', pendingId: queued[0]!.pendingId, pendingKind: 'crop', crop: TRANSFORM });
    expect(photoOf(doc!).pendingUpload).toBeUndefined();
  });

  it('queues once for two saves in one frame', async () => {
    const { ds, hook } = setup();
    ds.setOnline(false);
    act(() => {
      hook.result.current.performPhotoCropSave(target, blob(), CROP);
      hook.result.current.performPhotoCropSave(target, blob(), CROP);
    });
    await flush();
    expect(await ds.media.store.list()).toHaveLength(1);
  });

  it('does not queue without a results document (nothing could mark it pending)', async () => {
    const { ds, hook } = setup({ withDoc: false });
    ds.setOnline(false);
    act(() => hook.result.current.performPhotoCropSave(target, blob(), CROP));
    await flush();
    expect(await ds.media.store.list()).toEqual([]);
    expect(ds.notifications).toHaveLength(1);
    expect(ds.notifications[0]!.message).toMatch(/not connected/i);
  });
});

describe('annotation', () => {
  it('declines (returns false) without a results document, uploading nothing', async () => {
    const { ds, hook } = setup({ withDoc: false });
    let handled = true;
    act(() => { handled = hook.result.current.performPhotoAnnotationSave(target, blob(), '[]'); });
    await flush();
    expect(handled).toBe(false);
    expect(ds.uploads).toEqual([]);
  });

  it('online: uploads through the data source and merges annotatedKey + the node tree into the doc', async () => {
    const { ds, doc, hook } = setup();
    let handled = false;
    act(() => { handled = hook.result.current.performPhotoAnnotationSave(target, blob(), '[{"t":"rect"}]'); });
    await flush();
    expect(handled).toBe(true);
    const up = ds.uploads[0]!;
    expect(up.hadDoc).toBe(true);
    expect(up.rec.kind).toBe('annotate');
    expect(up.rec.kind === 'annotate' && up.rec.meta).toMatchObject({
      findingKey: FK, photoKey: 'base.jpg', photoIndex: 0, nodesJson: '[{"t":"rect"}]', sectionId: 's1',
    });
    expect(photoOf(doc!)).toMatchObject({ key: 'base.jpg', annotatedKey: `uploaded/${up.rec.pendingId}`, annotationsJson: '[{"t":"rect"}]' });
    expect(ds.notifications).toEqual([]);
  });

  it('an annotation for a photo that cannot be addressed is reported as handled, sends nothing and says so', async () => {
    const { ds, hook } = setup();
    let handled = false;
    act(() => { handled = hook.result.current.performPhotoAnnotationSave({ ...target, photoIndex: 5 }, blob(), '[]'); });
    await flush();
    expect(handled).toBe(true);
    expect(ds.uploads).toEqual([]);
    expect(ds.notifications).toHaveLength(1);
    expect(ds.notifications[0]).toMatchObject({ variant: 'error' });
    expect(ds.notifications[0]!.message).toMatch(/cannot be found/i);
  });

  it('a failed online bake changes nothing and says nothing, but still reports the save as handled', async () => {
    const { ds, doc, hook } = setup();
    ds.failUpload('HTTP_500');
    let handled = false;
    act(() => { handled = hook.result.current.performPhotoAnnotationSave(target, blob(), '[]'); });
    await flush();
    expect(handled).toBe(true);
    expect(photoOf(doc!)).toEqual({ key: 'base.jpg', mediaType: 'photo' });
    expect(ds.notifications).toEqual([]);
  });

  it('offline: queues the PNG and marks the photo pending-annotate, keeping every existing key', async () => {
    const { ds, doc, hook } = setup();
    ds.setOnline(false);
    let handled = false;
    act(() => { handled = hook.result.current.performPhotoAnnotationSave(target, blob(), '[{"t":"rect"}]'); });
    await flush();
    expect(handled).toBe(true);
    expect(ds.uploads).toEqual([]);
    const queued = await ds.media.store.list('insp1');
    expect(queued.map((r) => r.kind)).toEqual(['annotate']);
    expect(photoOf(doc!)).toMatchObject({ key: 'base.jpg', pendingId: queued[0]!.pendingId, pendingKind: 'annotate', annotationsJson: '[{"t":"rect"}]' });
  });

  it('sends one upload for two saves in one frame and reports both as handled', async () => {
    const { ds, hook } = setup();
    const held = heldUploader(ds);
    const handled: boolean[] = [];
    act(() => {
      handled.push(hook.result.current.performPhotoAnnotationSave(target, blob(), '[]'));
      handled.push(hook.result.current.performPhotoAnnotationSave(target, blob(), '[]'));
    });
    expect(handled).toEqual([true, true]);
    expect(held.calls).toHaveLength(1);
    expect(ds.notifications.map((n) => n.variant)).toEqual(['info']);
    await act(async () => { held.releases[0]!({ ok: true, key: 'a.png' }); });
    await flush();
    act(() => { hook.result.current.performPhotoAnnotationSave(target, blob(), '[]'); });
    expect(held.calls).toHaveLength(2);
  });
});

describe('urls and pending blobs', () => {
  it('the studio and the cropper open on urls.photo of the right key', () => {
    const { hook, ctx } = setup();
    const photo = { key: 'ann.jpg', url: '', label: '', itemId: 'i1', photoIndex: 0, originalKey: 'base.jpg', croppedKey: 'crop.jpg' } as never;
    act(() => hook.result.current.onViewerAction('annotate', photo));
    expect(ctx.setPhotoStudioUrl).toHaveBeenCalledWith('/photo-url/insp1/crop.jpg');
    act(() => hook.result.current.onViewerAction('crop', photo));
    expect(hook.result.current.photoCropTarget?.sourceUrl).toBe('/photo-url/insp1/base.jpg');
  });

  it('gallery photos take their url from urls.photo', () => {
    const { hook } = setup();
    expect(hook.result.current.itemGalleryPhotos('i1').map((p) => p.url)).toEqual(['/photo-url/insp1/base.jpg']);
  });

  it('a pending photo renders from the local blob the media store answers', async () => {
    const { ds, hook, ctx } = setup();
    ctx.findings.getResult = () => ({ photos: [{ key: '', pendingUpload: true, pendingId: 'p-1' }] });
    await ds.media.store.put({
      pendingId: 'p-1', inspectionId: 'insp1', kind: 'photo', blob: blob(), createdAt: 1,
      meta: { targetType: 'item', findingKey: FK, itemId: 'i1' },
    });
    ctx.state.sections = [{ id: 's1', items: [{ id: 'i1' }] }] as never;
    hook.rerender();
    await flush();
    expect(hook.result.current.pendingPhotoUrl('p-1')).toBe('blob:fake/p-1');
  });
});
