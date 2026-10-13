/**
 * Resolving pending photo entries: the pure half (validation and the swap
 * itself, on a bare Y.Doc) and the service-side stub caller. The Durable Object
 * branch is covered in workerd by tests/workers/collab/resolve-pending.spec.ts.
 *
 * Also pins the `/followup` extraction (`followupResponse`), which moved out of
 * the object to keep it under its size cap.
 */

import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import {
    seedResultsDoc, pushPendingPhoto, appendPhoto, projectResults, replacePhotoByPendingId, loadResultsProjection,
} from '../../../server/lib/collab/results-doc';
import { validatePendingMap, resolvePendingKeys, MAX_PENDING_ENTRIES } from '../../../server/durable-objects/inspection-doc-import';
import { resolvePendingInDo } from '../../../server/lib/collab/resolve-pending-route';
import { followupResponse } from '../../../server/lib/collab/followup-patch';
import type { PhotoEntry } from '../../../server/lib/collab/results-doc.types';

const SCOPE = { tenantId: 't1', inspectionId: 'insp1' };
const PREFIX = 't1/inspections/insp1/photos/';
const IDENTITY = { ...SCOPE, reportId: 'rpt-insp1', userId: 'u1' };
const KEY = '_default:s1:i1';

function pending(pendingId: string): PhotoEntry & { pendingId: string } {
    return { key: '', pendingUpload: true, pendingId, pendingKind: 'photo' };
}

function docWithPending(): Y.Doc {
    const doc = new Y.Doc();
    seedResultsDoc(doc, [{ findingKey: KEY }]);
    pushPendingPhoto(doc, KEY, pending('A'));
    pushPendingPhoto(doc, KEY, pending('B'));
    return doc;
}

const photos = (doc: Y.Doc): PhotoEntry[] => (projectResults(doc)[KEY]?.photos as PhotoEntry[] | undefined) ?? [];

describe('validatePendingMap', () => {
    it('accepts keys under the scope photo prefix and returns a Map', () => {
        const out = validatePendingMap({ A: `${PREFIX}A.jpg` }, SCOPE);
        expect(out).toEqual({ ok: true, map: new Map([['A', `${PREFIX}A.jpg`]]) });
    });

    it.each([
        ['another tenant', 'other/inspections/insp1/photos/A.jpg'],
        ['another inspection', 't1/inspections/insp2/photos/A.jpg'],
        ['a sibling prefix', 't1/inspections/insp1-x/photos/A.jpg'],
        ['a traversal', `${PREFIX}../../x.jpg`],
        ['a backslash', `${PREFIX}a\\b.jpg`],
        ['a control character', `${PREFIX}a\u0000.jpg`],
        ['the bare prefix', PREFIX],
    ])('refuses a key with %s, while the legal key passes', (_label, key) => {
        expect(validatePendingMap({ A: key }, SCOPE)).toMatchObject({ ok: false, status: 400, reason: 'invalid_key' });
        expect(validatePendingMap({ A: `${PREFIX}A.jpg` }, SCOPE).ok).toBe(true);
    });

    it('refuses a pendingId outside the allowed alphabet or length, keeping a hostile id inert', () => {
        for (const id of ['a b', 'a/b', '', 'x'.repeat(65)]) {
            expect(validatePendingMap({ [id]: `${PREFIX}A.jpg` }, SCOPE)).toMatchObject({ ok: false, reason: 'invalid_pending_id' });
        }
        // JSON.parse yields an own "__proto__" key; it is a legal id and must stay a plain map entry.
        const hostile: unknown = JSON.parse(`{"__proto__":"${PREFIX}A.jpg"}`);
        const out = validatePendingMap(hostile, SCOPE);
        expect(out.ok && out.map.get('__proto__')).toBe(`${PREFIX}A.jpg`);
    });

    it('refuses non-objects and enforces the entry limit exactly', () => {
        for (const raw of [null, [], 'x', 3]) {
            expect(validatePendingMap(raw, SCOPE)).toMatchObject({ ok: false, status: 400, reason: 'invalid_body' });
        }
        const make = (n: number): Record<string, string> => Object.fromEntries(Array.from({ length: n }, (_, i) => [`p${i}`, `${PREFIX}${i}.jpg`]));
        expect(validatePendingMap(make(MAX_PENDING_ENTRIES + 1), SCOPE)).toMatchObject({ ok: false, status: 413 });
        expect(validatePendingMap(make(MAX_PENDING_ENTRIES), SCOPE).ok).toBe(true);
    });
});

describe('resolvePendingKeys', () => {
    it('replaces matching pending entries in place and strips the pending markers', () => {
        const doc = docWithPending();
        const out = resolvePendingKeys(doc, new Map([['A', `${PREFIX}A.jpg`]]));
        expect(out).toEqual({ matched: 1, unmatched: 0, changed: true });
        expect(photos(doc)[0]).toEqual({ key: `${PREFIX}A.jpg` });
        expect(photos(doc)[1]).toMatchObject({ pendingId: 'B', pendingUpload: true });
    });

    it('is idempotent: a second run reports nothing changed and leaves the bytes alone', () => {
        const doc = docWithPending();
        const map = new Map([['A', `${PREFIX}A.jpg`], ['B', `${PREFIX}B.jpg`]]);
        resolvePendingKeys(doc, map);
        const state = Y.encodeStateAsUpdate(doc);
        expect(resolvePendingKeys(doc, map)).toEqual({ matched: 0, unmatched: 2, changed: false });
        expect(Y.encodeStateAsUpdate(doc)).toEqual(state);
    });

    it('resolves one message worth of updates in a single transaction', () => {
        const doc = docWithPending();
        const updates = vi.fn();
        doc.on('update', updates);
        resolvePendingKeys(doc, new Map([['A', `${PREFIX}A.jpg`], ['B', `${PREFIX}B.jpg`]]));
        expect(updates).toHaveBeenCalledTimes(1);
    });

    it('does not seed an item that does not exist (unlike the shared single-entry helper, it only walks what is there)', () => {
        const doc = new Y.Doc();
        seedResultsDoc(doc, [{ findingKey: KEY }]);
        expect(resolvePendingKeys(doc, new Map([['A', `${PREFIX}A.jpg`]]))).toEqual({ matched: 0, unmatched: 1, changed: false });
        expect(Object.keys(projectResults(doc))).toEqual([KEY]);
    });

    it('leaves a crop derivative alone: it has a pendingId but is not pendingUpload', () => {
        const doc = new Y.Doc();
        seedResultsDoc(doc, [{ findingKey: KEY }]);
        appendPhoto(doc, KEY, { key: 'base.jpg', pendingId: 'A', pendingKind: 'crop' });
        expect(resolvePendingKeys(doc, new Map([['A', `${PREFIX}A.jpg`]])).matched).toBe(0);
        expect(photos(doc)[0].key).toBe('base.jpg');
    });

    it('matches the client swap: the shared replacePhotoByPendingId produces the same entry', () => {
        const server = docWithPending();
        resolvePendingKeys(server, new Map([['A', `${PREFIX}A.jpg`]]));
        const client = docWithPending();
        replacePhotoByPendingId(client, KEY, 'A', { key: `${PREFIX}A.jpg` });
        expect(photos(server)).toEqual(photos(client));
    });
});

describe('resolvePendingInDo — failures come back as data', () => {
    const stubOf = (answer: () => Response | Promise<Response>) => ({ fetch: vi.fn().mockImplementation(() => Promise.resolve().then(answer)) });

    it('sends the verified identity and the map, and returns the counts', async () => {
        const stub = stubOf(() => Response.json({ ok: true, matched: 1, unmatched: 0, changed: true }));
        const out = await resolvePendingInDo(stub, IDENTITY, { A: `${PREFIX}A.jpg` });
        expect(out).toEqual({ ok: true, matched: 1, unmatched: 0, changed: true });
        const sent = stub.fetch.mock.calls[0][0] as Request;
        expect(new URL(sent.url).pathname).toBe('/resolve-pending');
        expect(sent.headers.get('x-tenant-id')).toBe('t1');
        expect(sent.headers.get('x-inspection-id')).toBe('insp1');
        expect(await sent.json()).toEqual({ A: `${PREFIX}A.jpg` });
    });

    it('refuses a foreign key before touching the object; a legal one reaches it', async () => {
        const stub = stubOf(() => Response.json({ ok: true, matched: 0, unmatched: 1, changed: false }));
        expect(await resolvePendingInDo(stub, IDENTITY, { A: 'other/inspections/insp1/photos/A.jpg' }))
            .toEqual({ ok: false, status: 400, reason: 'invalid_key' });
        expect(stub.fetch).not.toHaveBeenCalled();
        expect((await resolvePendingInDo(stub, IDENTITY, { A: `${PREFIX}A.jpg` })).ok).toBe(true);
        expect(stub.fetch).toHaveBeenCalledTimes(1);
    });

    it.each([[400, 'invalid_body'], [413, 'too_large'], [500, 'apply_failed'], [503, 'persist_failed']] as const)(
        'maps a DO %i refusal to data carrying its reason', async (status, reason) => {
            const out = await resolvePendingInDo(stubOf(() => Response.json({ ok: false, reason }, { status })), IDENTITY, {});
            expect(out).toEqual({ ok: false, status, reason });
        });

    it('maps an unreachable object, an odd status, and an odd answer to 502 without throwing', async () => {
        const down = { fetch: vi.fn().mockRejectedValue(new Error('down')) };
        expect(await resolvePendingInDo(down, IDENTITY, {})).toEqual({ ok: false, status: 502, reason: 'do_unreachable' });
        expect(await resolvePendingInDo(stubOf(() => new Response('x', { status: 404 })), IDENTITY, {}))
            .toEqual({ ok: false, status: 502, reason: 'do_error' });
        expect(await resolvePendingInDo(stubOf(() => Response.json({ ok: true })), IDENTITY, {}))
            .toEqual({ ok: false, status: 502, reason: 'unexpected_answer' });
    });
});

describe('followupResponse — the extracted /followup branch', () => {
    const req = (body: string): Request => new Request('https://do.local/followup', { method: 'POST', body });
    const carried = (): Y.Doc => {
        const doc = new Y.Doc();
        loadResultsProjection(doc, { [KEY]: { original: { rating: 'Defect' }, followupStatus: null } });
        return doc;
    };

    it('hydrates, patches and persists a carried item; refuses what is not carried', async () => {
        const doc = carried();
        const hydrate = vi.fn().mockResolvedValue(undefined);
        const persist = vi.fn().mockResolvedValue(undefined);
        const ok = await followupResponse(doc, req('{"itemId":"i1","status":"fixed","notes":"done"}'), hydrate, persist);
        expect(ok.status).toBe(200);
        expect(await ok.json()).toEqual({ ok: true, findingKey: KEY });
        expect(projectResults(doc)[KEY]).toMatchObject({ followupStatus: 'fixed', followupNotes: 'done' });
        expect(hydrate).toHaveBeenCalledTimes(1);
        expect(persist).toHaveBeenCalledTimes(1);

        const missing = await followupResponse(doc, req('{"itemId":"nope","status":"x"}'), hydrate, persist);
        expect(missing.status).toBe(404);
        expect(persist).toHaveBeenCalledTimes(1);
    });

    it('answers 400 for a body that is not JSON, not an object, or has no itemId, without hydrating', async () => {
        const hydrate = vi.fn().mockResolvedValue(undefined);
        const persist = vi.fn().mockResolvedValue(undefined);
        for (const body of ['nope', 'null', '[]', '{}', '{"itemId":""}']) {
            expect((await followupResponse(carried(), req(body), hydrate, persist)).status, body).toBe(400);
        }
        expect(hydrate).not.toHaveBeenCalled();
        expect(persist).not.toHaveBeenCalled();
    });
});
