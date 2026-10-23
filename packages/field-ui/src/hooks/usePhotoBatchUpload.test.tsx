// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { FieldDataSourceProvider } from '../context';
import type { FieldDataSource, MediaUploader, PendingMediaRecord } from '../data-source';
import { createEmptyEditorData, createFakeDataSource } from '../testing/fake-data-source';
import { usePhotoBatchUpload } from './usePhotoBatchUpload';
import type { PhotoBatch, PhotoBatchUploader } from './usePhotoBatchUpload';

afterEach(cleanup);

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

function file(name: string): Blob {
  return new Blob([name], { type: 'image/jpeg' });
}

function batch(over: Partial<PhotoBatch> = {}): PhotoBatch {
  return { itemId: 'item-1', findingKey: '_default:sec-1:item-1', files: [file('a'), file('b')], target: null, ...over };
}

/** A data source whose uploader parks every upload until the test settles it, and records the order they began. */
function parkedSource() {
  const fake = createFakeDataSource({ data: createEmptyEditorData() });
  const started: PendingMediaRecord[] = [];
  const settle: Array<(r: { ok: true; key: string } | { ok: false; error: string }) => void> = [];
  const uploader: MediaUploader = {
    upload: (rec) =>
      new Promise((resolve) => {
        started.push(rec);
        settle.push(resolve);
      }),
  };
  const ds: FieldDataSource = { ...fake, media: { ...fake.media, uploader: () => uploader } };
  return { ds, started, settle };
}

let latest: PhotoBatchUploader;
function Harness({ doc = null }: { doc?: null }) {
  latest = usePhotoBatchUpload('insp-1', doc);
  return <span data-testid="busy">{String(latest.busy)}</span>;
}

function mount(ds: FieldDataSource) {
  return render(
    <FieldDataSourceProvider dataSource={ds}>
      <Harness />
    </FieldDataSourceProvider>,
  );
}

describe('usePhotoBatchUpload', () => {
  it('uploads each file through the host uploader and answers keys in input order', async () => {
    const fake = createFakeDataSource({ data: createEmptyEditorData() });
    mount(fake);
    act(() => latest.submit(batch()));
    expect(latest.busy).toBe(true);
    await flush();
    expect(fake.uploads.map((u) => u.rec.pendingId)).toHaveLength(2);
    expect(latest.busy).toBe(false);
    expect(latest.outcomes).toHaveLength(1);
    const [out] = latest.outcomes;
    expect(out.ok).toBe(true);
    expect(out.results.map((r) => r.index)).toEqual([0, 1]);
    expect(out.keys).toEqual(out.results.map((r) => r.key));
    expect(out).toMatchObject({ itemId: 'item-1', targetType: 'item', customId: '', defectKind: 'canned' });
    expect(fake.uploads[0].rec).toMatchObject({
      kind: 'photo',
      inspectionId: 'insp-1',
      meta: { targetType: 'item', itemId: 'item-1', findingKey: '_default:sec-1:item-1' },
    });
  });

  it('binds a defect-targeted batch to its row', async () => {
    const fake = createFakeDataSource({ data: createEmptyEditorData() });
    mount(fake);
    act(() => latest.submit(batch({ files: [file('a')], target: { kind: 'custom', id: 'c-9' } })));
    await flush();
    expect(fake.uploads[0].rec.meta).toMatchObject({ targetType: 'defect', customId: 'c-9', defectKind: 'custom' });
    expect(latest.outcomes[0]).toMatchObject({ targetType: 'defect', customId: 'c-9', defectKind: 'custom', ok: true });
  });

  it('reports a partly failed batch per file, keeps the keys that did upload, and is not ok', async () => {
    const fake = createFakeDataSource({ data: createEmptyEditorData() });
    let n = 0;
    const ds: FieldDataSource = {
      ...fake,
      media: {
        ...fake.media,
        uploader: () => ({
          upload: async () => {
            n += 1;
            return n === 2 ? { ok: false as const, error: 'HTTP_500' } : { ok: true as const, key: `k${n}` };
          },
        }),
      },
    };
    mount(ds);
    act(() => latest.submit(batch({ files: [file('a'), file('b'), file('c')] })));
    await flush();
    const [out] = latest.outcomes;
    expect(out.ok).toBe(false);
    expect(out.results.map((r) => r.ok)).toEqual([true, false, true]);
    expect(out.results[1]).toMatchObject({ error: 'HTTP_500' });
    expect(out.keys).toEqual(['k1', 'k3']);
  });

  it('turns an uploader that throws into a failed file, never into a rejected batch', async () => {
    const fake = createFakeDataSource({ data: createEmptyEditorData() });
    const ds: FieldDataSource = {
      ...fake,
      media: {
        ...fake.media,
        uploader: () => ({
          upload: async () => {
            throw new Error('boom');
          },
        }),
      },
    };
    mount(ds);
    act(() => latest.submit(batch({ files: [file('a')] })));
    await flush();
    expect(latest.outcomes[0]).toMatchObject({ ok: false, keys: [], results: [{ index: 0, ok: false, error: 'EXCEPTION' }] });
    expect(latest.busy).toBe(false);
  });

  it('runs two batches submitted in ONE act one after the other, and loses neither', async () => {
    const { ds, started, settle } = parkedSource();
    mount(ds);
    act(() => {
      latest.submit(batch({ itemId: 'first', files: [file('a')] }));
      latest.submit(batch({ itemId: 'second', files: [file('b')] }));
    });
    await flush();
    // Only the first batch has reached the uploader; the second waits its turn.
    expect(started.map((r) => r.meta.itemId)).toEqual(['first']);
    expect(latest.busy).toBe(true);
    await act(async () => { settle[0]({ ok: true, key: 'k-first' }); });
    await flush();
    expect(started.map((r) => r.meta.itemId)).toEqual(['first', 'second']);
    // The first batch's answer is kept while the second is still out (the page attaches it now).
    expect(latest.outcomes.map((o) => o.itemId)).toEqual(['first']);
    expect(latest.busy).toBe(true);
    await act(async () => { settle[1]({ ok: true, key: 'k-second' }); });
    await flush();
    expect(latest.outcomes.map((o) => [o.itemId, o.keys])).toEqual([['first', ['k-first']], ['second', ['k-second']]]);
    expect(latest.busy).toBe(false);
  });

  it('CONTROL - a batch submitted after the first has settled goes through at once', async () => {
    const { ds, started, settle } = parkedSource();
    mount(ds);
    act(() => latest.submit(batch({ itemId: 'first', files: [file('a')] })));
    await flush();
    await act(async () => { settle[0]({ ok: true, key: 'k1' }); });
    await flush();
    act(() => latest.submit(batch({ itemId: 'later', files: [file('b')] })));
    await flush();
    expect(started.map((r) => r.meta.itemId)).toEqual(['first', 'later']);
  });

  it('uploads at most four files of one batch at a time', async () => {
    const { ds, started } = parkedSource();
    mount(ds);
    act(() => latest.submit(batch({ files: Array.from({ length: 7 }, (_, i) => file(String(i))) })));
    await flush();
    expect(started).toHaveLength(4);
  });

  it('consume drops the oldest outcomes and keeps the rest', async () => {
    const fake = createFakeDataSource({ data: createEmptyEditorData() });
    mount(fake);
    act(() => {
      latest.submit(batch({ itemId: 'one', files: [file('a')] }));
      latest.submit(batch({ itemId: 'two', files: [file('b')] }));
    });
    await flush();
    await flush();
    expect(latest.outcomes.map((o) => o.itemId)).toEqual(['one', 'two']);
    act(() => latest.consume(1));
    expect(latest.outcomes.map((o) => o.itemId)).toEqual(['two']);
    act(() => latest.consume(0));
    expect(latest.outcomes.map((o) => o.itemId)).toEqual(['two']);
  });

  it('shows busy while a batch is out', async () => {
    const { ds, settle } = parkedSource();
    mount(ds);
    expect(screen.getByTestId('busy').textContent).toBe('false');
    act(() => latest.submit(batch({ files: [file('a')] })));
    expect(screen.getByTestId('busy').textContent).toBe('true');
    await flush();
    await act(async () => { settle[0]({ ok: true, key: 'k' }); });
    await flush();
    expect(screen.getByTestId('busy').textContent).toBe('false');
  });

  it('remembers an earlier batch failure for the whole busy period, even after its outcome was consumed', async () => {
    const { ds, settle } = parkedSource();
    mount(ds);
    act(() => {
      latest.submit(batch({ itemId: 'first', files: [file('a')] }));
      latest.submit(batch({ itemId: 'second', files: [file('b')] }));
    });
    await flush();
    await act(async () => { settle[0]({ ok: false, error: 'HTTP_500' }); });
    await flush();
    // The page handles the first outcome while the second batch is still out.
    act(() => latest.consume(latest.outcomes.length));
    expect(latest.outcomes).toEqual([]);
    expect(latest.busy).toBe(true);
    await act(async () => { settle[1]({ ok: true, key: 'k2' }); });
    await flush();
    // Idle now, and only the successful second outcome is left: the period still reads as failed.
    expect(latest.busy).toBe(false);
    expect(latest.outcomes.map((o) => o.ok)).toEqual([true]);
    expect(latest.failedSinceIdle).toBe(true);
  });

  it('CONTROL - a clean run reads as not failed, and a new run after a failed one starts clean', async () => {
    const { ds, settle } = parkedSource();
    mount(ds);
    act(() => latest.submit(batch({ files: [file('a')] })));
    await flush();
    await act(async () => { settle[0]({ ok: false, error: 'HTTP_500' }); });
    await flush();
    expect(latest.failedSinceIdle).toBe(true);
    act(() => latest.submit(batch({ files: [file('b')] })));
    expect(latest.failedSinceIdle).toBe(false);
    await flush();
    await act(async () => { settle[1]({ ok: true, key: 'k' }); });
    await flush();
    expect(latest.busy).toBe(false);
    expect(latest.failedSinceIdle).toBe(false);
  });
});
