import { describe, expect, it, vi } from 'vitest';
import type { EditorData, PendingMediaRecord } from '../data-source';
import { createFakeDataSource } from './fake-data-source';

function editorData(overrides: Partial<EditorData> = {}): EditorData {
  return {
    inspection: { id: 'insp-1', propertyAddress: '1 Main St' },
    schema: { sections: [] },
    results: {},
    ratingLevels: [],
    tagLibrary: [],
    defectCategories: [],
    units: [],
    unitProgress: { units: [], commonRated: 0, total: 0 },
    unitInspectionMode: 'tagged',
    templateSnapshot: null,
    revisionStatus: null,
    statutoryDetails: null,
    statutoryCoverage: null,
    compliance: null,
    pcaNarrative: null,
    relianceText: null,
    commercialPresets: {},
    nextPublishIsAmendment: false,
    outboundCoolingWindow: null,
    resultId: null,
    ...overrides,
  };
}

function record(pendingId: string, inspectionId: string): PendingMediaRecord {
  return { pendingId, inspectionId, kind: 'photo', blob: new Blob(['x']), meta: {}, createdAt: 1 };
}

describe('createFakeDataSource', () => {
  it('load returns the seed data', async () => {
    const data = editorData({ resultId: 'r-9' });
    const ds = createFakeDataSource({ data });
    const loaded = await ds.load('insp-1');
    expect(loaded).toBe(data);
    expect(loaded.resultId).toBe('r-9');
  });

  it('records executed commands in order and answers ok', async () => {
    const ds = createFakeDataSource({ data: editorData() });
    const a = await ds.execute('insp-1', { type: 'complete' });
    const b = await ds.execute('insp-1', { type: 'set-cover', coverPhotoId: 'p1' });
    expect(a).toEqual({ ok: true });
    expect(b).toEqual({ ok: true });
    expect(ds.commands).toEqual([
      { inspectionId: 'insp-1', cmd: { type: 'complete' } },
      { inspectionId: 'insp-1', cmd: { type: 'set-cover', coverPhotoId: 'p1' } },
    ]);
  });

  it('an injected execute failure is returned, recorded, and applies to the matching command only', async () => {
    const ds = createFakeDataSource({ data: editorData() });
    ds.failExecute('publish', 'nope');
    const failed = await ds.execute('insp-1', { type: 'publish', autoSignOnPublish: false, markComplete: false });
    const other = await ds.execute('insp-1', { type: 'complete' });
    expect(failed).toEqual({ ok: false, error: 'nope' });
    expect(other).toEqual({ ok: true });
    expect(ds.commands.map((c) => c.cmd.type)).toEqual(['publish', 'complete']);
  });

  describe('media store', () => {
    it('stores, reads and deletes records', async () => {
      const { media } = createFakeDataSource({ data: editorData() });
      await media.store.put(record('a', 'insp-1'));
      expect((await media.store.get('a'))?.pendingId).toBe('a');
      expect(await media.store.get('missing')).toBeNull();
      await media.store.delete('a');
      expect(await media.store.get('a')).toBeNull();
    });

    it('lists everything, or only one inspection when filtered', async () => {
      const { media } = createFakeDataSource({ data: editorData() });
      await media.store.put(record('a', 'insp-1'));
      await media.store.put(record('b', 'insp-2'));
      expect((await media.store.list()).map((r) => r.pendingId).sort()).toEqual(['a', 'b']);
      expect((await media.store.list('insp-2')).map((r) => r.pendingId)).toEqual(['b']);
    });

    it('objectUrl is a string for a stored record and null for an unknown one', async () => {
      const { media } = createFakeDataSource({ data: editorData() });
      await media.store.put(record('a', 'insp-1'));
      expect(typeof (await media.store.objectUrl('a'))).toBe('string');
      expect(await media.store.objectUrl('missing')).toBeNull();
    });

    it('an injected put failure rejects and stores nothing; without it put resolves', async () => {
      const ds = createFakeDataSource({ data: editorData() });
      await expect(ds.media.store.put(record('ok', 'insp-1'))).resolves.toBeUndefined();
      ds.failMediaPut(new Error('quota'));
      await expect(ds.media.store.put(record('bad', 'insp-1'))).rejects.toThrow('quota');
      expect(await ds.media.store.get('bad')).toBeNull();
      expect(await ds.media.store.get('ok')).not.toBeNull();
    });

    it('the uploader answers ok with a key', async () => {
      const ds = createFakeDataSource({ data: editorData() });
      const res = await ds.media.uploader('insp-1').upload(record('a', 'insp-1'));
      expect(res.ok).toBe(true);
    });
  });

  describe('collab', () => {
    it('connect returns a writable doc whose persistence is already synced', async () => {
      const ds = createFakeDataSource({ data: editorData() });
      const handle = ds.collab.connect('insp-1', {});
      handle.doc.getMap('m').set('k', 'v');
      expect(handle.doc.getMap('m').get('k')).toBe('v');
      await expect(handle.persistenceSynced).resolves.toBeUndefined();
      expect(handle.synced()).toBe(true);
      expect(() => handle.destroy()).not.toThrow();
    });

    it('records purges', async () => {
      const ds = createFakeDataSource({ data: editorData() });
      expect(ds.purged).toEqual([]);
      await ds.collab.purge('insp-1');
      expect(ds.purged).toEqual(['insp-1']);
    });
  });

  describe('connectivity', () => {
    it('reports the seeded state and follows setOnline', () => {
      const ds = createFakeDataSource({ data: editorData(), online: false });
      expect(ds.isOnline()).toBe(false);
      ds.setOnline(true);
      expect(ds.isOnline()).toBe(true);
    });

    it('notifies subscribers while subscribed and stops after unsubscribe', () => {
      const ds = createFakeDataSource({ data: editorData() });
      const cb = vi.fn();
      const off = ds.onOnlineChange(cb);
      ds.setOnline(false);
      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenLastCalledWith(false);
      off();
      ds.setOnline(true);
      expect(cb).toHaveBeenCalledTimes(1);
    });
  });

  it('counts reload and exit calls', () => {
    const ds = createFakeDataSource({ data: editorData() });
    expect([ds.reloadCount, ds.exitCount]).toEqual([0, 0]);
    ds.reload();
    ds.reload();
    ds.exit();
    expect([ds.reloadCount, ds.exitCount]).toEqual([2, 1]);
  });

  describe('seed overrides', () => {
    it('session, platform and urls default sensibly and can be overridden', () => {
      const defaults = createFakeDataSource({ data: editorData() });
      expect(defaults.platform).toBe('web');
      expect(defaults.session().collabEditing).toBe(false);
      expect(defaults.urls.reportPdf('insp-1')).toBeNull();

      const custom = createFakeDataSource({
        data: editorData(),
        platform: 'android',
        session: { tenantSlug: 'acme', collabEditing: true },
        urls: { photo: (i, k) => `/p/${i}/${k}` },
      });
      expect(custom.platform).toBe('android');
      expect(custom.session().tenantSlug).toBe('acme');
      expect(custom.session().collabEditing).toBe(true);
      expect(custom.urls.photo('i', 'k')).toBe('/p/i/k');
    });

    it('resources are all absent by default and present when provided', () => {
      const none = createFakeDataSource({ data: editorData() });
      expect(none.resources.aiAssist).toBeUndefined();
      expect(none.resources.costItems).toBeUndefined();
      expect(none.resources.commentsLibrary).toBeUndefined();
      expect(none.resources.versionHistory).toBeUndefined();
      expect(none.resources.video).toBeUndefined();

      const some = createFakeDataSource({
        data: editorData(),
        resources: { aiAssist: { run: async () => ({ ok: true }) } },
      });
      expect(some.resources.aiAssist).toBeDefined();
      expect(some.resources.costItems).toBeUndefined();
    });
  });
});
