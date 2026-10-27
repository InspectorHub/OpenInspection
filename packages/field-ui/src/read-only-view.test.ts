import { describe, it, expect } from 'vitest';
import type { FieldDataSource } from './data-source';
import { m } from './i18n';
import { readOnlyView } from './read-only-view';
import { createEmptyEditorData, createFakeCommentsLibrary, createFakeCostItems, createFakeDataSource, createFakeVersionHistory, createFakeVideo } from './testing/fake-data-source';
import type { PendingMediaRecord } from './media-types';

function spied() {
  const fake = createFakeDataSource({
    data: createEmptyEditorData(),
    resources: { commentsLibrary: createFakeCommentsLibrary(), costItems: createFakeCostItems(), versionHistory: createFakeVersionHistory(), video: createFakeVideo() },
  });
  const calls: string[] = [];
  const note = <F extends (...a: never[]) => unknown>(name: string, f: F): F => ((...a: never[]) => { calls.push(name); return f(...a); }) as F;
  const ds: FieldDataSource = {
    ...fake,
    execute: note('execute', fake.execute),
    media: {
      ...fake.media,
      store: { ...fake.media.store, put: note('put', fake.media.store.put), delete: note('delete', fake.media.store.delete), list: note('list', fake.media.store.list) },
      uploader: (id, doc) => { const u = fake.media.uploader(id, doc); return { upload: note('upload', u.upload) }; },
    },
    resources: {
      ...fake.resources,
      commentsLibrary: { ...fake.resources.commentsLibrary!, save: note('save', fake.resources.commentsLibrary!.save), list: note('commentsList', fake.resources.commentsLibrary!.list) },
      costItems: { ...fake.resources.costItems!, save: note('costSave', fake.resources.costItems!.save), list: note('costList', fake.resources.costItems!.list) },
      versionHistory: { ...fake.resources.versionHistory!, restore: note('restore', fake.resources.versionHistory!.restore), list: note('versionList', fake.resources.versionHistory!.list) },
      video: { ...fake.resources.video!, finalize: note('finalize', fake.resources.video!.finalize) },
    },
  };
  return { ds, calls };
}

const REC: PendingMediaRecord = {
  pendingId: 'p1', inspectionId: 'i1', kind: 'photo', blob: new Blob(['x']), createdAt: 1,
  meta: { targetType: 'item', findingKey: '_default:s:i', itemId: 'i' },
};

describe('readOnlyView', () => {
  it('refuses every write without reaching the host, and says why', async () => {
    const { ds, calls } = spied();
    const view = readOnlyView(ds);
    const reason = m.editor_read_only();
    expect(await view.execute('i1', { type: 'save-pca-narrative', key: 'k', value: 'v' } as never)).toEqual({ ok: false, error: reason });
    await expect(view.media.store.put(REC)).rejects.toThrow(reason);
    await expect(view.media.store.delete('p1')).rejects.toThrow(reason);
    expect(await view.media.uploader('i1', null).upload(REC)).toEqual({ ok: false, error: reason });
    expect(await view.resources.commentsLibrary!.save({ text: 't' } as never)).toEqual({ ok: false, error: reason });
    expect(await view.resources.costItems!.save('i1', {} as never)).toEqual({ ok: false, error: reason });
    expect(await view.resources.versionHistory!.restore('i1', 1)).toEqual({ ok: false, error: reason });
    expect(await view.resources.video!.finalize('i1', {} as never)).toEqual({ ok: false, error: reason });
    expect(calls).toEqual([]);
  });

  it('CONTROL - the same calls on the host itself do reach it', async () => {
    const { ds, calls } = spied();
    await ds.execute('i1', { type: 'save-pca-narrative', key: 'k', value: 'v' } as never);
    await ds.media.store.put(REC).catch(() => undefined);
    await ds.media.uploader('i1', null).upload(REC);
    await ds.resources.commentsLibrary!.save({ text: 't' } as never);
    expect(calls).toEqual(['execute', 'put', 'upload', 'save']);
  });

  it('passes reads through to the host', async () => {
    const { ds, calls } = spied();
    const view = readOnlyView(ds);
    await view.media.store.list();
    await view.resources.commentsLibrary!.list();
    await view.resources.costItems!.list('i1');
    await view.resources.versionHistory!.list('i1');
    expect(calls).toEqual(['list', 'commentsList', 'costList', 'versionList']);
    expect(view.session()).toEqual(ds.session());
    expect(view.urls).toBe(ds.urls);
  });

  it('leaves notify alone so the refusal can be shown', () => {
    const { ds } = spied();
    expect(readOnlyView(ds).notify).toBe(ds.notify);
  });

  it('keeps a resource the host does not provide absent', () => {
    const fake = createFakeDataSource({ data: createEmptyEditorData() });
    expect(readOnlyView(fake).resources.video).toBeUndefined();
    expect(readOnlyView(fake).resources.costItems).toBeUndefined();
  });
});
