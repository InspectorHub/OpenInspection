/**
 * `POST /api/inspections/:id/collab/import` — the route in front of the
 * Durable Object's offline import.
 *
 * Asserts, with the DO namespace fully mocked:
 *   - identity comes from the verified JWT only; an unauthenticated, cross-tenant
 *     or unassigned caller is refused and the DO is never addressed
 *   - the DO is addressed with the verified identity, never one the request carried
 *   - the body is bounded: 411 without a length, 413 on a declared or actual
 *     overrun (and a declared overrun is not read at all), 400 when empty
 *   - the audit row is written on success and only on success
 *
 * Every refusal has a positive control: the same request with the fault removed
 * reaches the DO.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import collabRoutes from '../../../server/api/inspections/collab';
import { MAX_IMPORT_BYTES } from '../../../server/durable-objects/inspection-doc-import';
import type { HonoConfig } from '../../../server/types/hono';

const getInspectionRoster = vi.fn();
vi.mock('../../../server/lib/inspection/roster', () => ({
    getInspectionRoster: (...args: unknown[]) => getInspectionRoster(...args),
}));

const resolvePrimaryReportId = vi.fn();
vi.mock('../../../server/lib/inspection/reports', () => ({
    resolvePrimaryReportId: (...args: unknown[]) => resolvePrimaryReportId(...args),
}));

const auditFromContext = vi.fn();
vi.mock('../../../server/lib/audit', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../server/lib/audit')>()),
    auditFromContext: (...args: unknown[]) => auditFromContext(...args),
}));

const PATH = '/api/inspections/insp1/collab/import';
const OK_ANSWER = () => Response.json({ ok: true, snapshotSeq: 7 });

function makeMockDo(answer: () => Response = OK_ANSWER) {
    const stubFetch = vi.fn().mockImplementation(() => Promise.resolve(answer()));
    const get = vi.fn().mockReturnValue({ fetch: stubFetch });
    const idFromName = vi.fn().mockReturnValue({ id: 'mock-do-id' });
    return { idFromName, get, stubFetch };
}

interface Options {
    tenantId?: string | null;
    userId?: string | null;
    userRole?: string;
    /** The tenant the inspection row actually belongs to. */
    rowTenantId?: string;
    leadId?: string;
    mockDo?: ReturnType<typeof makeMockDo>;
}

function buildApp(opts: Options = {}) {
    const {
        tenantId = 't1', userId = 'u1', userRole = 'inspector', rowTenantId = 't1', leadId = 'u1',
    } = opts;
    const mockDo = opts.mockDo ?? makeMockDo();

    resolvePrimaryReportId.mockReset().mockResolvedValue('rpt-insp1');
    getInspectionRoster.mockReset().mockResolvedValue({
        lead: { id: leadId, name: leadId, email: `${leadId}@example.com` },
        helpers: [],
    });
    auditFromContext.mockReset();

    const getInspection = vi.fn().mockImplementation((_id: string, callerTenantId: string) => {
        if (rowTenantId !== callerTenantId) throw new Error('not found');
        return Promise.resolve({ inspection: { id: 'insp1', tenantId: rowTenantId }, template: null });
    });

    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.env = { INSPECTION_DOC: mockDo, DB: {} } as unknown as HonoConfig['Bindings'];
        if (tenantId !== null) c.set('tenantId', tenantId);
        if (userId !== null) c.set('user', { sub: userId } as never);
        c.set('userRole', userRole as never);
        c.set('services', { inspection: { getInspection } } as never);
        await next();
    });
    app.route('/api/inspections', collabRoutes);
    return { app, mockDo };
}

const BYTES = Uint8Array.from([1, 2, 3, 4, 5]);

function post(app: ReturnType<typeof buildApp>['app'], body: BodyInit | null, headers: Record<string, string> = {}, extra: RequestInit = {}) {
    return app.request(PATH, { method: 'POST', body, headers, ...extra });
}

const withLength = (n: number): Record<string, string> => ({ 'content-length': String(n) });

/** A body that records whether anyone started reading it. */
function watchedStream(chunks: Uint8Array[]): { stream: ReadableStream<Uint8Array>; pulled: () => boolean } {
    let pulled = false;
    let i = 0;
    const stream = new ReadableStream<Uint8Array>({
        pull(ctl) {
            pulled = true;
            const next = chunks[i++];
            if (next) ctl.enqueue(next); else ctl.close();
        },
    // highWaterMark 0: nothing is pulled until a consumer asks, so `pulled` means "someone read it".
    }, { highWaterMark: 0 });
    return { stream, pulled: () => pulled };
}

const HALF_DUPLEX = { duplex: 'half' } as RequestInit;

describe('POST /:id/collab/import — authorization', () => {
    beforeEach(() => vi.clearAllMocks());

    it('refuses an unauthenticated caller with 401 and never addresses the DO', async () => {
        const { app, mockDo } = buildApp({ tenantId: null, userId: null });
        const res = await post(app, BYTES, withLength(BYTES.length));
        expect(res.status).toBe(401);
        expect(mockDo.idFromName).not.toHaveBeenCalled();
        expect(mockDo.stubFetch).not.toHaveBeenCalled();
    });

    it('answers 404 for an inspection of another tenant and never addresses the DO', async () => {
        const { app, mockDo } = buildApp({ tenantId: 't2', userId: 'u-other', rowTenantId: 't1' });
        const res = await post(app, BYTES, withLength(BYTES.length));
        expect(res.status).toBe(404);
        expect(mockDo.idFromName).not.toHaveBeenCalled();
        expect(mockDo.stubFetch).not.toHaveBeenCalled();
        expect(auditFromContext).not.toHaveBeenCalled();
    });

    it('answers 403 for an inspector who is not on the inspection', async () => {
        const { app, mockDo } = buildApp({ userId: 'u-stranger', leadId: 'u1' });
        const res = await post(app, BYTES, withLength(BYTES.length));
        expect(res.status).toBe(403);
        expect(mockDo.stubFetch).not.toHaveBeenCalled();
    });

    it('does not read the body for a caller who is refused', async () => {
        const { app } = buildApp({ userId: 'u-stranger', leadId: 'u1' });
        const { stream, pulled } = watchedStream([BYTES]);
        const res = await post(app, stream, withLength(BYTES.length), HALF_DUPLEX);
        expect(res.status).toBe(403);
        expect(pulled()).toBe(false);
    });
});

describe('POST /:id/collab/import — forwarding', () => {
    beforeEach(() => vi.clearAllMocks());

    it('forwards the bytes with the VERIFIED identity, ignoring identity headers on the request', async () => {
        const { app, mockDo } = buildApp();
        const res = await post(app, BYTES, {
            ...withLength(BYTES.length),
            'x-tenant-id': 'evil-tenant', 'x-user-id': 'evil-user', 'x-report-id': 'evil-report', 'x-inspection-id': 'evil-insp',
        });
        expect(res.status, await res.clone().text()).toBe(200);
        expect(await res.json()).toEqual({ ok: true, snapshotSeq: 7 });

        expect(mockDo.idFromName).toHaveBeenCalledWith('t1:rpt-insp1');
        expect(mockDo.stubFetch).toHaveBeenCalledTimes(1);
        const fwd = mockDo.stubFetch.mock.calls[0][0] as Request;
        expect(fwd.method).toBe('POST');
        expect(new URL(fwd.url).pathname).toBe('/import');
        expect(fwd.headers.get('x-tenant-id')).toBe('t1');
        expect(fwd.headers.get('x-inspection-id')).toBe('insp1');
        expect(fwd.headers.get('x-report-id')).toBe('rpt-insp1');
        expect(fwd.headers.get('x-user-id')).toBe('u1');
        expect(new Uint8Array(await fwd.arrayBuffer())).toEqual(BYTES);
    });

    it('writes one audit row on success, carrying the snapshot sequence and size', async () => {
        const { app } = buildApp();
        await post(app, BYTES, withLength(BYTES.length));
        expect(auditFromContext).toHaveBeenCalledTimes(1);
        expect(auditFromContext.mock.calls[0].slice(1)).toEqual([
            'inspection.collab.import', 'inspection',
            { entityId: 'insp1', metadata: { snapshotSeq: 7, bytes: BYTES.length } },
        ]);
    });

    it('passes a refusal from the DO through unchanged and writes no audit row', async () => {
        const mockDo = makeMockDo(() => Response.json({ ok: false, reason: 'snapshot_failed' }, { status: 503 }));
        const { app } = buildApp({ mockDo });
        const res = await post(app, BYTES, withLength(BYTES.length));
        expect(res.status).toBe(503);
        expect(await res.json()).toEqual({ ok: false, reason: 'snapshot_failed' });
        expect(auditFromContext).not.toHaveBeenCalled();
    });

    it('answers 502 and writes no audit row when the DO answers 200 with something unexpected', async () => {
        const mockDo = makeMockDo(() => Response.json({ ok: true }));
        const { app } = buildApp({ mockDo });
        const res = await post(app, BYTES, withLength(BYTES.length));
        expect(res.status).toBe(502);
        expect(auditFromContext).not.toHaveBeenCalled();
    });
});

describe('POST /:id/collab/import — body bounds', () => {
    beforeEach(() => vi.clearAllMocks());

    it('answers 411 when no length is declared; the same bytes with a length reach the DO', async () => {
        const { app, mockDo } = buildApp();
        const res = await post(app, BYTES);
        expect(res.status).toBe(411);
        expect(mockDo.stubFetch).not.toHaveBeenCalled();

        expect((await post(app, BYTES, withLength(BYTES.length))).status).toBe(200);
        expect(mockDo.stubFetch).toHaveBeenCalledTimes(1);
    });

    it('answers 413 for a declared length over the limit WITHOUT reading the body', async () => {
        const { app, mockDo } = buildApp();
        const { stream, pulled } = watchedStream([BYTES]);
        const res = await post(app, stream, withLength(MAX_IMPORT_BYTES + 1), HALF_DUPLEX);
        expect(res.status).toBe(413);
        expect(pulled()).toBe(false);
        expect(mockDo.stubFetch).not.toHaveBeenCalled();
    });

    it('answers 413 when the bytes actually sent exceed the limit despite a small declared length', async () => {
        const { app, mockDo } = buildApp();
        const chunk = new Uint8Array(1024 * 1024);
        const { stream, pulled } = watchedStream(Array.from({ length: 7 }, () => chunk));
        const res = await post(app, stream, withLength(10), HALF_DUPLEX);
        expect(res.status).toBe(413);
        // Control for the "not read" probes above: here the body WAS consumed.
        expect(pulled()).toBe(true);
        expect(mockDo.stubFetch).not.toHaveBeenCalled();
    });

    it('accepts a body of exactly the limit', async () => {
        const { app, mockDo } = buildApp();
        const res = await post(app, new Uint8Array(MAX_IMPORT_BYTES), withLength(MAX_IMPORT_BYTES));
        expect(res.status, await res.clone().text()).toBe(200);
        expect(mockDo.stubFetch).toHaveBeenCalledTimes(1);
    });

    it('answers 400 for an empty body, and for a length that is not a number', async () => {
        const { app, mockDo } = buildApp();
        expect((await post(app, new Uint8Array(0), withLength(0))).status).toBe(400);
        expect((await post(app, BYTES, { 'content-length': 'abc' })).status).toBe(400);
        expect(mockDo.stubFetch).not.toHaveBeenCalled();

        expect((await post(app, BYTES, withLength(BYTES.length))).status).toBe(200);
    });
});
