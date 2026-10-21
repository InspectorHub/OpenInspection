/**
 * The six JSON collab routes (snapshot list, one snapshot, capture, restore, restructure, follow-up) are OpenAPI
 * routes. Their handlers are unchanged, so these pin what the conversion must not move: the plain-text refusals of
 * the shared authorization, the ORDER (authorization first, then the body), the handler own `{ error }` 400s, that the
 * Durable Object answer is passed through byte for byte, and what the document says about them.
 */
import { describe, it, expect, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import collabRoutes from '../../../server/api/inspections/collab';
import { buildOpenApiDocument } from '../../../server/lib/openapi/build-document';
import { parseReinspectionStatuses } from '../../../server/lib/reinspection-status';
import type { HonoConfig } from '../../../server/types/hono';

const getInspectionRoster = vi.fn();
vi.mock('../../../server/lib/inspection/roster', () => ({
    getInspectionRoster: (...args: unknown[]) => getInspectionRoster(...args),
}));
const resolvePrimaryReportId = vi.fn();
vi.mock('../../../server/lib/inspection/reports', () => ({
    resolvePrimaryReportId: (...args: unknown[]) => resolvePrimaryReportId(...args),
}));
// The follow-up vocabulary is read from the company config; no row means the defaults.
vi.mock('drizzle-orm/d1', () => ({
    drizzle: () => ({ select: () => ({ from: () => ({ where: () => ({ get: async () => undefined }) }) }) }),
}));

const DEFAULT_KEY = parseReinspectionStatuses(null)[0]!.key;

interface Options { userId?: string | null; doAnswer?: Response; withDo?: boolean; rostered?: boolean }

function buildApp(opts: Options = {}) {
    const { userId = 'u1', withDo = true, rostered = true } = opts;
    const stubFetch = vi.fn().mockImplementation(async () => opts.doAnswer?.clone() ?? Response.json({ ok: true }));
    const ns = { idFromName: vi.fn().mockReturnValue({ id: 'do-id' }), get: vi.fn().mockReturnValue({ fetch: stubFetch }) };
    getInspectionRoster.mockReset().mockResolvedValue({ lead: rostered ? { id: 'u1', name: 'u1', email: 'u1@example.com' } : null, helpers: [] });
    resolvePrimaryReportId.mockReset().mockResolvedValue('rpt-1');
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.env = { INSPECTION_DOC: withDo ? ns : undefined, DB: {} } as unknown as HonoConfig['Bindings'];
        c.set('tenantId', 't1');
        if (userId !== null) c.set('user', { sub: userId } as never);
        c.set('userRole', 'inspector' as never);
        c.set('services', { inspection: { getInspection: vi.fn().mockResolvedValue({ inspection: { id: 'insp1' } }) } } as never);
        await next();
    });
    app.route('/api/inspections', collabRoutes);
    return { app, stubFetch, ns };
}

const post = (body?: string) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body }) });

describe('the JSON collab routes refuse in plain text before the Durable Object is contacted', () => {
    const ROUTES: Array<[string, string, RequestInit]> = [
        ['list', '/api/inspections/insp1/collab/snapshots', {}],
        ['get', '/api/inspections/insp1/collab/snapshots/3', {}],
        ['capture', '/api/inspections/insp1/collab/snapshots', { method: 'POST' }],
        ['restore', '/api/inspections/insp1/collab/restore', post('{"seq":1}')],
        ['restructure', '/api/inspections/insp1/collab/restructure', { method: 'POST' }],
        ['followup', '/api/inspections/insp1/collab/followup', post(`{"itemId":"a","status":null}`)],
    ];

    it.each(ROUTES)('%s: 401 unauthorized, 403 forbidden and 501 collab unavailable, each as text/plain', async (_name, url, init) => {
        const noUser = buildApp({ userId: null });
        const r401 = await noUser.app.request(url, init);
        expect([r401.status, await r401.text()]).toEqual([401, 'unauthorized']);
        const notRostered = buildApp({ rostered: false });
        const r403 = await notRostered.app.request(url, init);
        expect([r403.status, await r403.text()]).toEqual([403, 'forbidden']);
        const noDo = buildApp({ withDo: false });
        const r501 = await noDo.app.request(url, init);
        expect([r501.status, await r501.text()]).toEqual([501, 'collab unavailable']);
        for (const b of [noUser, notRostered, noDo]) expect(b.stubFetch).not.toHaveBeenCalled();
        // Positive control: the same request from a rostered user reaches the Durable Object.
        const ok = buildApp();
        expect((await ok.app.request(url, init)).status).toBe(200);
        expect(ok.stubFetch).toHaveBeenCalledTimes(1);
    });

    it('authorizes before it reads the body: an unrostered caller with a body that is not JSON sees 403, not the 400', async () => {
        for (const path of ['restore', 'followup']) {
            const { app } = buildApp({ rostered: false });
            const res = await app.request(`/api/inspections/insp1/collab/${path}`, post('{nope'));
            expect([res.status, await res.text()]).toEqual([403, 'forbidden']);
        }
    });
});

describe('what each route forwards, and what it answers', () => {
    it('passes the Durable Object answer through unchanged: its JSON, its plain-text 404 and its 400', async () => {
        const list = buildApp({ doAnswer: Response.json([{ seq: 0, atMs: 5, byUserId: 'u1' }]) });
        const res = await list.app.request('/api/inspections/insp1/collab/snapshots');
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual([{ seq: 0, atMs: 5, byUserId: 'u1' }]);

        const missing = buildApp({ doAnswer: new Response('snapshot not found', { status: 404 }) });
        const r404 = await missing.app.request('/api/inspections/insp1/collab/snapshots/9');
        expect([r404.status, await r404.text()]).toEqual([404, 'snapshot not found']);

        const restore = buildApp({ doAnswer: new Response('snapshot not found', { status: 404 }) });
        const rr = await restore.app.request('/api/inspections/insp1/collab/restore', post('{"seq":9}'));
        expect([rr.status, await rr.text()]).toEqual([404, 'snapshot not found']);
    });

    it('addresses the Durable Object by report and forwards the identity headers and the validated body only', async () => {
        const { app, stubFetch, ns } = buildApp();
        const res = await app.request('/api/inspections/insp1/collab/restore', post('{"seq":4,"extra":"dropped"}'));
        expect(res.status).toBe(200);
        expect(ns.idFromName).toHaveBeenCalledWith('t1:rpt-1');
        const sent = stubFetch.mock.calls[0]![0] as Request;
        expect([sent.method, sent.url]).toEqual(['POST', 'https://do.local/restore']);
        expect(sent.headers.get('x-tenant-id')).toBe('t1');
        expect(sent.headers.get('x-inspection-id')).toBe('insp1');
        expect(sent.headers.get('x-report-id')).toBe('rpt-1');
        expect(sent.headers.get('x-user-id')).toBe('u1');
        expect(await sent.text()).toBe('{"seq":4}');
    });

    it('answers its own { error } 400 for a snapshot seq that is not a whole number, and for a restore body that is not valid', async () => {
        const seq = await buildApp().app.request('/api/inspections/insp1/collab/snapshots/abc');
        expect([seq.status, await seq.json()]).toEqual([400, { error: 'invalid snapshot seq' }]);
        const notJson = await buildApp().app.request('/api/inspections/insp1/collab/restore', post('{nope'));
        expect([notJson.status, await notJson.json()]).toEqual([400, { error: 'invalid JSON body' }]);
        const badSeq = await buildApp().app.request('/api/inspections/insp1/collab/restore', post('{"seq":-1}'));
        expect([badSeq.status, await badSeq.json()]).toEqual([400, { error: 'invalid restore request' }]);
        const noStub = buildApp();
        await noStub.app.request('/api/inspections/insp1/collab/restore', post('{"seq":-1}'));
        expect(noStub.stubFetch).not.toHaveBeenCalled();
    });

    it('checks a follow-up status against the company vocabulary before forwarding, and forwards a key from it (null clears)', async () => {
        const refused = buildApp();
        const bad = await refused.app.request('/api/inspections/insp1/collab/followup', post(JSON.stringify({ itemId: 'a', status: 'not-a-status' })));
        expect(bad.status).toBe(400);
        const body = await bad.json() as { error: string; allowed: string[] };
        expect(body.error).toBe('unknown follow-up status');
        expect(body.allowed).toContain(DEFAULT_KEY);
        expect(refused.stubFetch).not.toHaveBeenCalled();

        const ok = buildApp();
        expect((await ok.app.request('/api/inspections/insp1/collab/followup', post(JSON.stringify({ itemId: 'a', status: DEFAULT_KEY })))).status).toBe(200);
        const cleared = buildApp();
        expect((await cleared.app.request('/api/inspections/insp1/collab/followup', post(JSON.stringify({ itemId: 'a', status: null })))).status).toBe(200);
        expect(await ((cleared.stubFetch.mock.calls[0]![0] as Request).text())).toBe('{"itemId":"a","status":null}');

        const invalid = await buildApp().app.request('/api/inspections/insp1/collab/followup', post('{"status":null}'));
        expect([invalid.status, await invalid.json()]).toEqual([400, { error: 'invalid follow-up request' }]);
    });
});

describe('the six operations in the OpenAPI document', () => {
    it('are excluded from MCP, describe no request body and say what a 404 can be', () => {
        const doc = buildOpenApiDocument(buildApp().app, { openapi: '3.0.0', info: { version: 'test', title: 't' } });
        const paths = doc.paths as Record<string, Record<string, Record<string, unknown>>>;
        const ops = [
            [paths['/api/inspections/{id}/collab/snapshots']?.get, 'listCollabSnapshots'],
            [paths['/api/inspections/{id}/collab/snapshots/{seq}']?.get, 'getCollabSnapshot'],
            [paths['/api/inspections/{id}/collab/snapshots']?.post, 'captureCollabSnapshot'],
            [paths['/api/inspections/{id}/collab/restore']?.post, 'restoreCollabSnapshot'],
            [paths['/api/inspections/{id}/collab/restructure']?.post, 'restructureCollabDocument'],
            [paths['/api/inspections/{id}/collab/followup']?.post, 'recordCollabFollowup'],
        ] as const;
        for (const [op, operationId] of ops) {
            expect(op?.operationId).toBe(operationId);
            expect(op?.['x-tier']).toBe('excluded');
            expect(op?.['x-scopes']).toEqual([]);
            expect(op?.requestBody).toBeUndefined();
            const responses = op?.responses as Record<string, { content?: Record<string, unknown>; description: string }>;
            expect(Object.keys(responses['401']?.content ?? {})).toEqual(['text/plain']);
            expect(responses['404']?.content).toBeUndefined();
        }
        // The WebSocket upgrade and the binary import are not described.
        expect(paths['/api/inspections/{id}/collab/ws']).toBeUndefined();
        expect(paths['/api/inspections/{id}/collab/import']).toBeUndefined();
    });
});
