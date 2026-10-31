// @vitest-environment happy-dom
/**
 * A crop or an annotation tells its caller whether the dialog may close: not while the image check refused it (the
 * person keeps the crop box or the strokes and can adjust or cancel), not while an earlier save of the same photo is
 * still out, and yes once the image is admitted. Called exactly once per save.
 */
import { createElement, type ReactNode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { FieldDataSourceProvider } from '../context';
import { MAX_PHOTO_BYTES } from '../shared/photo-limits';
import { appendPhoto, seedResultsDoc } from '../shared/results-doc';
import { createEmptyEditorData, createFakeDataSource } from '../testing/fake-data-source';
import { usePhotoOps } from './usePhotoOps';

afterEach(cleanup);

const FK = '_default:s1:i1';
const CROP = { aspect: '3:2', orientation: 'landscape' as const, pixels: { x: 1, y: 2, width: 30, height: 20 } };
const target = { itemId: 'i1', photoIndex: 0, sectionId: 's1' };
const sized = (size: number) => {
  const bytes = new Uint8Array(size);
  bytes.set([0xff, 0xd8, 0xff, 0xe0]);
  return new Blob([bytes], { type: 'image/jpeg' });
};
const good = () => sized(4);
const tooLarge = () => sized(MAX_PHOTO_BYTES + 1);
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });

function setup(withDoc = true) {
  const ds = createFakeDataSource({ data: createEmptyEditorData() });
  const doc = withDoc ? new Y.Doc() : null;
  if (doc) {
    seedResultsDoc(doc, [{ findingKey: FK }]);
    appendPhoto(doc, FK, { key: 'base.jpg', mediaType: 'photo' });
  }
  const ctx = {
    state: {
      inspection: { id: 'insp1', coverPhotoId: null }, sections: [], results: {}, currentSection: undefined,
      sectionIdForItem: (itemId: string) => (itemId === 'i1' ? 's1' : null), setResults: vi.fn(), setDirty: vi.fn(),
    },
    findings: { getResult: () => ({ photos: [{ key: 'base.jpg' }] }) },
    streamCustomerSubdomain: null, collabDoc: doc, activeUnitId: null,
    setPhotoStudioUrl: vi.fn(), setPhotoStudioKey: vi.fn(), setPhotoStudioIndex: vi.fn(), setPhotoStudioTotal: vi.fn(), setPhotoStudioOpen: vi.fn(),
  };
  const wrapper = ({ children }: { children: ReactNode }) => createElement(FieldDataSourceProvider, { dataSource: ds }, children);
  const hook = renderHook(() => usePhotoOps(ctx as unknown as Parameters<typeof usePhotoOps>[0]), { wrapper });
  return { ds, hook };
}
type Hook = ReturnType<typeof setup>['hook'];

const saves = [
  ['crop', (h: Hook, b: Blob, cb: (ok: boolean) => void) => { h.result.current.performPhotoCropSave(target, b, CROP, cb); }],
  ['annotation', (h: Hook, b: Blob, cb: (ok: boolean) => void) => { h.result.current.performPhotoAnnotationSave(target, b, '[{"t":"rect"}]', cb); }],
] as const;

describe.each(saves)('%s: the caller is told whether the dialog may close', (_name, save) => {
  for (const online of [true, false]) {
    const where = online ? 'online' : 'offline';

    it(`${where}: a refused image keeps the dialog open, and a second save after the refusal works`, async () => {
      const { ds, hook } = setup();
      ds.setOnline(online);
      const told: boolean[] = [];
      act(() => save(hook, tooLarge(), (ok) => { told.push(ok); }));
      expect(told).toEqual([]); // not before the check has answered
      await flush();
      expect(told).toEqual([false]);
      act(() => save(hook, good(), (ok) => { told.push(ok); }));
      await flush();
      expect(told).toEqual([false, true]);
      expect(online ? ds.uploads : await ds.media.store.list()).toHaveLength(1);
    });

    it(`${where}: CONTROL - an admissible image lets the dialog close, once`, async () => {
      const { ds, hook } = setup();
      ds.setOnline(online);
      const told: boolean[] = [];
      act(() => save(hook, good(), (ok) => { told.push(ok); }));
      await flush();
      expect(told).toEqual([true]);
    });
  }

  it('a save while an earlier one for the same photo is still out keeps the dialog open', async () => {
    const { hook } = setup();
    const first: boolean[] = [];
    const told: boolean[] = [];
    act(() => { save(hook, good(), (ok) => { first.push(ok); }); save(hook, good(), (ok) => { told.push(ok); }); });
    expect(told).toEqual([false]);
    await flush();
    expect(first).toEqual([true]); // the first save is unharmed and closes its dialog, once
    expect(told).toEqual([false]);
  });

  it('a callback that answers false calls the save off: nothing is patched, queued or sent', async () => {
    const { ds, hook } = setup();
    act(() => save(hook, good(), () => false));
    await flush();
    expect(ds.uploads).toHaveLength(0);
    expect(await ds.media.store.list()).toHaveLength(0);
  });

  it('a check that throws leaves the dialog open (false), says the save failed and frees the photo', async () => {
    const { ds, hook } = setup();
    const told: boolean[] = [];
    const broken = { size: 4, type: 'image/jpeg', arrayBuffer: () => Promise.reject(new Error('unreadable: secret')), slice: () => broken } as unknown as Blob;
    act(() => save(hook, broken, (ok) => { told.push(ok); }));
    await flush();
    expect(told).toEqual([false]);
    expect(ds.notifications.map((n) => n.message)).toHaveLength(1);
    expect(JSON.stringify(ds.notifications)).not.toContain('secret');
    act(() => save(hook, good(), (ok) => { told.push(ok); }));
    await flush();
    expect(told).toEqual([false, true]);
  });

});

describe('no live document yet', () => {
  it('crop: the save is dropped with a message and the dialog STAYS open with the crop in it', async () => {
    const { hook, ds } = setup(false);
    const told: boolean[] = [];
    act(() => { hook.result.current.performPhotoCropSave(target, good(), CROP, (ok) => { told.push(ok); }); });
    await flush();
    expect(told).toEqual([false]);
    expect(ds.notifications).toHaveLength(1);
  });

  it('crop: a photo that no longer exists closes the dialog (there is nothing left to crop) with a message', async () => {
    const { hook, ds } = setup();
    const told: boolean[] = [];
    act(() => { hook.result.current.performPhotoCropSave({ ...target, photoIndex: 5 }, good(), CROP, (ok) => { told.push(ok); }); });
    await flush();
    expect(told).toEqual([true]);
    expect(ds.notifications).toHaveLength(1);
  });

  it('annotation: hands back to the caller (returns false) and does not call back', async () => {
    const { hook } = setup(false);
    const told: boolean[] = [];
    let handled = true;
    act(() => { handled = hook.result.current.performPhotoAnnotationSave(target, good(), '[]', (ok) => { told.push(ok); }); });
    await flush();
    expect(handled).toBe(false);
    expect(told).toEqual([]);
  });
});
