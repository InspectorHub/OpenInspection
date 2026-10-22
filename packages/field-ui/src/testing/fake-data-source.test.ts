import * as Y from 'yjs';
import { describe, expect, it, vi } from 'vitest';
import type { EditorData, PendingMediaRecord } from '../data-source';
import {
  createEmptyEditorData,
  createFakeDataSource,
  createFakePrefs,
  createFakeTemplateSearch,
  createFakeVersionHistory,
  createFakeVideo,
} from './fake-data-source';

function editorData(overrides: Partial<EditorData> = {}): EditorData {
  return createEmptyEditorData(overrides);
}

function record(pendingId: string, inspectionId: string): PendingMediaRecord {
  return {
    pendingId,
    inspectionId,
    kind: 'photo',
    blob: new Blob(['x']),
    meta: { findingKey: '_default:s1:i1', itemId: 'i1', targetType: 'item' },
    createdAt: 1,
  };
}

describe('createEmptyEditorData', () => {
  it('gives the non-null members the loader always returns an object default', () => {
    const data = createEmptyEditorData();
    expect(data.templateSnapshot).toEqual({ schemaVersion: 2, sections: [] });
    expect(data.compliance).toEqual({
      reportSignoffs: [],
      psq: null,
      documentReview: [],
      conformance: { standard: 'E2018-24', conforms: false },
    });
    expect(Object.keys(data.relianceText).sort()).toEqual(['pointInTime', 'siteSpecific', 'userReliance']);
    expect(Object.keys(data.pcaNarrative)).toHaveLength(9);
  });

  it('keeps the members the loader really nulls as null, and applies overrides', () => {
    const data = createEmptyEditorData({ resultId: 'r-1' });
    expect(data.revisionStatus).toBeNull();
    expect(data.statutoryDetails).toBeNull();
    expect(data.statutoryCoverage).toBeNull();
    expect(data.outboundCoolingWindow).toBeNull();
    expect(data.resultId).toBe('r-1');
    expect(createEmptyEditorData().resultId).toBeNull();
  });
});

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

  describe('typed command data', () => {
    it('answers a registered response with its data, only for the matching command', async () => {
      const ds = createFakeDataSource({ data: editorData() });
      ds.respondWith('load-scope', { scope: 'u1', results: { 'u1:s1:i1': { rating: 'a' } } });
      const hit = await ds.execute('insp-1', { type: 'load-scope', scope: 'u1' });
      expect(hit.ok).toBe(true);
      expect(hit.data?.results['u1:s1:i1']).toEqual({ rating: 'a' });
      const miss = await ds.execute('insp-1', { type: 'complete' });
      expect(miss).toEqual({ ok: true });
    });

    it('distinguishes the ops of one command type', async () => {
      const ds = createFakeDataSource({ data: editorData() });
      ds.respondWith('compliance:signoff', { role: 'field_observer' });
      const signoff = await ds.execute('insp-1', {
        type: 'compliance',
        op: 'signoff',
        role: 'field_observer',
        personId: 'p1',
        name: 'N',
        license: null,
        dualRole: false,
      });
      const other = await ds.execute('insp-1', { type: 'compliance', op: 'doc-review-seed' });
      expect(signoff.data).toEqual({ role: 'field_observer' });
      expect(other).toEqual({ ok: true });
    });

    it('carries the autofill reason on a failed result when a response is registered', async () => {
      const ds = createFakeDataSource({ data: editorData() });
      ds.respondWith('autofill-property-facts', { facts: null, reason: 'BAD_ADDRESS' });
      ds.failExecute('autofill-property-facts', 'bad address');
      const res = await ds.execute('insp-1', { type: 'autofill-property-facts', addressString: '1' });
      expect(res.ok).toBe(false);
      expect(res.error).toBe('bad address');
      expect(res.data).toEqual({ facts: null, reason: 'BAD_ADDRESS' });
    });
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

    it('onChange fires on a doc update and stops after destroy', () => {
      const ds = createFakeDataSource({ data: editorData() });
      const onChange = vi.fn();
      const handle = ds.collab.connect('insp-1', { onChange });
      handle.doc.getMap('m').set('a', 1);
      expect(onChange).toHaveBeenCalledTimes(1);
      handle.destroy();
      // A separate doc proves the callback is not simply dead: only this handle's doc is silenced.
      const other = ds.collab.connect('insp-1', { onChange });
      other.doc.getMap('m').set('b', 2);
      expect(onChange).toHaveBeenCalledTimes(2);
      expect(() => Y.applyUpdate(handle.doc, Y.encodeStateAsUpdate(other.doc))).not.toThrow();
      expect(onChange).toHaveBeenCalledTimes(2);
    });

    it('onSynced fires once, after connect returns, and not before', async () => {
      const ds = createFakeDataSource({ data: editorData() });
      const onSynced = vi.fn();
      const handle = ds.collab.connect('insp-1', { onSynced });
      expect(onSynced).not.toHaveBeenCalled();
      await handle.persistenceSynced;
      await Promise.resolve();
      expect(onSynced).toHaveBeenCalledTimes(1);
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

  describe('prefs resource', () => {
    it('is absent by default; a fake prefs resource loads defaults and merges patches', async () => {
      expect(createFakeDataSource({ data: editorData() }).resources.prefs).toBeUndefined();

      const prefs = createFakePrefs();
      const ds = createFakeDataSource({ data: editorData(), resources: { prefs } });
      const first = await ds.resources.prefs!.load();
      expect(first.autoAdvance).toBe('always');
      expect(first.pinnedTagIds).toEqual([]);

      const res = await ds.resources.prefs!.patch({ autoAdvance: 'off', pinnedTagIds: ['t1'] });
      expect(res.ok).toBe(true);
      // The echo is the merged result, as a real host answers.
      expect(res.data).toMatchObject({ autoAdvance: 'off', pinnedTagIds: ['t1'] });
      const second = await ds.resources.prefs!.load();
      expect(second.autoAdvance).toBe('off');
      expect(second.pinnedTagIds).toEqual(['t1']);
      // A field the delta did not name is untouched.
      expect(second.requireDefectFields).toBe(first.requireDefectFields);
      expect(prefs.patches).toEqual([{ autoAdvance: 'off', pinnedTagIds: ['t1'] }]);
    });

    it('a patch can be made to fail and then leaves the stored prefs unchanged', async () => {
      const prefs = createFakePrefs();
      prefs.failPatch('offline');
      const res = await prefs.patch({ autoAdvance: 'keyboard' });
      expect(res).toEqual({ ok: false, error: 'offline' });
      expect((await prefs.load()).autoAdvance).toBe('always');
    });
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

    it('an undefined session override does not erase the default; a defined one wins', () => {
      const ds = createFakeDataSource({ data: editorData(), session: { role: undefined, userId: 'u-7' } });
      const session = ds.session();
      expect(session.role).toBe('fake-role');
      expect(session.userId).toBe('u-7');
      const nulled = createFakeDataSource({ data: editorData(), session: { tenantSlug: null } });
      expect(nulled.session().tenantSlug).toBeNull();
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

describe('new resource fakes and session fields', () => {
  it('records template searches, version captures and poster picks, with configurable results', async () => {
    const search = createFakeTemplateSearch();
    expect(await search.search({ q: 'a', page: 2 })).toEqual({ templates: [], hasMore: false, page: 1, totalPages: 1 });
    search.setResult({ templates: [{ id: 't1', name: 'T' }], hasMore: true, page: 2, totalPages: 3 });
    expect((await search.search({ q: '', page: 1 })).templates).toHaveLength(1);
    expect(search.searches).toEqual([{ q: 'a', page: 2 }, { q: '', page: 1 }]);

    const history = createFakeVersionHistory();
    expect(await history.capture('i1')).toEqual({ ok: true });
    history.failCapture('nope');
    expect(await history.capture('i2')).toEqual({ ok: false, error: 'nope' });
    expect(history.captures).toEqual(['i1', 'i2']);

    const video = createFakeVideo();
    expect(await video.setPoster('i1', { streamUid: 's', posterPct: 0.5 })).toEqual({ ok: true });
    expect(video.posters).toEqual([{ inspectionId: 'i1', streamUid: 's', posterPct: 0.5 }]);
  });

  it('overrides session fields without erasing defaults, and records the idempotency key only when given', async () => {
    const ds = createFakeDataSource({
      data: editorData(),
      session: { locale: 'es-MX', timeZone: 'America/Denver', tenantDateFormat: 'eu', dateFormat: undefined },
    });
    expect(ds.session()).toMatchObject({ locale: 'es-MX', timeZone: 'America/Denver', tenantDateFormat: 'eu', dateFormat: 'us' });
    await ds.execute('i1', { type: 'complete' });
    await ds.execute('i1', { type: 'complete' }, { idempotencyKey: 'k1' });
    expect(ds.commands).toEqual([
      { inspectionId: 'i1', cmd: { type: 'complete' } },
      { inspectionId: 'i1', cmd: { type: 'complete' }, idempotencyKey: 'k1' },
    ]);
  });
});
