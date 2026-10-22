// @vitest-environment happy-dom
/**
 * The offline media drain, through the data source.
 *
 * The hook used to import the web media store and the web uploader and listen for the browser's
 * `online` event itself. It now reads `media.store`, `media.uploader(id, doc)` and
 * `onOnlineChange` from the provider. Pinned here: oldest record first, a failed record stays
 * queued and the next drain retries it, a successful one swaps its doc entry to the real key
 * and leaves the queue, the uploader is handed the live doc, no doc means no drain, going
 * online drains and going offline does not, and two triggers in one frame upload each record once.
 */
import { createElement, type ReactNode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { appendPendingPhoto, markPhotoPending } from '../collab/results-binding';
import { FieldDataSourceProvider } from '../context';
import type { MediaUploader } from '../media-types';
import { appendPhoto, projectResults, seedResultsDoc } from '../shared/results-doc';
import { createEmptyEditorData, createFakeDataSource, type FakeDataSource } from '../testing/fake-data-source';
import { useMediaDrain } from './useMediaDrain';

afterEach(cleanup);

const FK = '_default:s1:i1';
let nextInspection = 0;

async function queue(ds: FakeDataSource, inspectionId: string, doc: Y.Doc, pendingId: string, createdAt: number) {
  appendPendingPhoto(doc, FK, pendingId);
  await ds.media.store.put({
    pendingId, inspectionId, kind: 'photo', blob: new Blob(['x'], { type: 'image/jpeg' }), createdAt,
    meta: { targetType: 'item', findingKey: FK, itemId: 'i1' },
  });
}

function setup(withDoc = true) {
  // The queue's in-flight guard is keyed by inspection id and module-wide: one id per test.
  const inspectionId = `drain-${(nextInspection += 1)}`;
  const ds = createFakeDataSource({ data: createEmptyEditorData() });
  const doc = withDoc ? new Y.Doc() : null;
  if (doc) seedResultsDoc(doc, [{ findingKey: FK }]);
  const revoked: string[] = [];
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(FieldDataSourceProvider, { dataSource: ds }, children);
  const hook = renderHook(() => useMediaDrain(inspectionId, doc, (id) => revoked.push(id)), { wrapper });
  return { ds, doc, hook, inspectionId, revoked };
}

const keysOf = (doc: Y.Doc) => ((projectResults(doc)[FK]?.photos ?? []) as Array<{ key: string; pendingUpload?: boolean }>).map((p) => p.key);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

describe('useMediaDrain', () => {
  it('uploads oldest first, swaps each doc entry to its real key, empties the queue and revokes the local urls', async () => {
    const { ds, doc, hook, inspectionId, revoked } = setup();
    await queue(ds, inspectionId, doc!, 'late', 30);
    await queue(ds, inspectionId, doc!, 'early', 10);
    await queue(ds, inspectionId, doc!, 'middle', 20);
    act(() => hook.result.current.drain());
    await settle();
    expect(ds.uploads.map((u) => u.rec.pendingId)).toEqual(['early', 'middle', 'late']);
    expect(ds.uploads.every((u) => u.inspectionId === inspectionId && u.hadDoc)).toBe(true);
    expect(await ds.media.store.list(inspectionId)).toEqual([]);
    expect(keysOf(doc!).sort()).toEqual(['uploaded/early', 'uploaded/late', 'uploaded/middle']);
    expect(revoked).toEqual(['early', 'middle', 'late']);
  });

  it('a failed upload stays queued with its doc entry still pending, and the next drain retries it', async () => {
    const { ds, doc, hook, inspectionId, revoked } = setup();
    await queue(ds, inspectionId, doc!, 'p1', 1);
    ds.failUpload('HTTP_503');
    act(() => hook.result.current.drain());
    await settle();
    expect((await ds.media.store.list(inspectionId)).map((r) => r.pendingId)).toEqual(['p1']);
    expect(keysOf(doc!)).toEqual(['']);
    expect(revoked).toEqual([]);
    // The host recovers; the same record goes up on the next trigger.
    ds.media.uploader = () => ({ upload: async (rec) => ({ ok: true, key: `retry/${rec.pendingId}` }) });
    act(() => hook.result.current.drain());
    await settle();
    expect(await ds.media.store.list(inspectionId)).toEqual([]);
    expect(keysOf(doc!)).toEqual(['retry/p1']);
  });

  it('maps the uploaded key onto the field of the record kind (crop -> croppedKey)', async () => {
    const { ds, doc, hook, inspectionId } = setup();
    // A crop record for a photo already in the doc.
    appendPhoto(doc!, FK, { key: 'base.jpg', mediaType: 'photo' });
    markPhotoPending(doc!, FK, 'base.jpg', 'c1', 'crop', {});
    await ds.media.store.put({
      pendingId: 'c1', inspectionId, kind: 'crop', blob: new Blob(['c']), createdAt: 1,
      meta: { findingKey: FK, itemId: 'i1', photoIndex: 1, photoKey: 'base.jpg', crop: { aspect: 'free', orientation: 'landscape', x: 0, y: 0, width: 1, height: 1 } },
    });
    act(() => hook.result.current.drain());
    await settle();
    const photo = (projectResults(doc!)[FK]?.photos ?? []).find((p) => p.key === 'base.jpg') as unknown as Record<string, unknown>;
    expect(photo.croppedKey).toBe('uploaded/c1');
    expect(photo.pendingId).toBeUndefined();
  });

  it('does nothing without a results document', async () => {
    const { ds, hook, inspectionId } = setup(false);
    await ds.media.store.put({
      pendingId: 'p1', inspectionId, kind: 'photo', blob: new Blob(['x']), createdAt: 1,
      meta: { targetType: 'item', findingKey: FK, itemId: 'i1' },
    });
    act(() => hook.result.current.drain());
    await settle();
    expect(ds.uploads).toEqual([]);
    expect(await ds.media.store.list(inspectionId)).toHaveLength(1);
  });

  it('drains when the host goes online, not when it goes offline, and stops listening on unmount', async () => {
    const { ds, doc, hook, inspectionId } = setup();
    await queue(ds, inspectionId, doc!, 'p1', 1);
    act(() => ds.setOnline(false));
    await settle();
    expect(ds.uploads).toEqual([]);
    act(() => ds.setOnline(true));
    await settle();
    expect(ds.uploads.map((u) => u.rec.pendingId)).toEqual(['p1']);
    hook.unmount();
    await queue(ds, inspectionId, doc!, 'p2', 2);
    act(() => ds.setOnline(false));
    act(() => ds.setOnline(true));
    await settle();
    expect(ds.uploads.map((u) => u.rec.pendingId)).toEqual(['p1']);
  });

  it('two triggers in one frame (a sync and a network-back) upload each record once', async () => {
    const { ds, doc, hook, inspectionId } = setup();
    await queue(ds, inspectionId, doc!, 'p1', 1);
    await queue(ds, inspectionId, doc!, 'p2', 2);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const seen: string[] = [];
    const uploader: MediaUploader = {
      upload: async (rec) => { seen.push(rec.pendingId); await gate; return { ok: true, key: `k/${rec.pendingId}` }; },
    };
    ds.media.uploader = () => uploader;
    act(() => {
      hook.result.current.drain();
      ds.setOnline(true);
      hook.result.current.drain();
    });
    await act(async () => { release(); await new Promise((r) => setTimeout(r, 20)); });
    expect(seen).toEqual(['p1', 'p2']);
    expect(await ds.media.store.list(inspectionId)).toEqual([]);
  });

  it('keeps one stable drain across re-renders', () => {
    const { hook } = setup();
    const first = hook.result.current.drain;
    hook.rerender();
    expect(hook.result.current.drain).toBe(first);
  });
});
