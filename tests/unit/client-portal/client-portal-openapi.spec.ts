/**
 * The client-portal document list/delete, the inspector document list/delete and the client message list/send are
 * OpenAPI routes. The end-to-end flows (real tokens, real database) are in client-document-routes.spec.ts and
 * client-message-routes.spec.ts; this file pins what the conversion must not change, with stub services: the exact
 * `{error}` bodies and statuses, that the actor check still runs before the body is read, the wire shape of every
 * success body, the staff role gate, that the plain handlers next to them still answer, and the operations in the
 * document.
 */
import { describe, it, expect, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import clientDocumentsRoutes, { inspectorDocumentsRoutes } from '../../../server/api/client-documents';
import { clientMessageRoutes } from '../../../server/api/messages';
import { AppError } from '../../../server/lib/errors';
import { buildOpenApiDocument } from '../../../server/lib/openapi/build-document';
import type { HonoConfig } from '../../../server/types/hono';

const TENANT = 't1';
const INSPECTION = 'insp1';
const TOKEN = 'good-token';

type Svc = Record<string, unknown>;

function row(over: Record<string, unknown> = {}) {
    return {
        id: 'd1', tenantId: TENANT, inspectionId: INSPECTION, uploadedByKind: 'client', uploadedByRef: 'client@x.com',
        uploadedByName: 'Pat', category: 'other', visibility: 'client_visible', r2Key: 'secret/key', filename: 'a.pdf',
        contentType: 'application/pdf', sizeBytes: 3, label: null, createdAt: new Date('2026-06-01T00:00:00Z'), ...over,
    };
}

/** A token stub that resolves GOOD_TOKEN to a live client grant for INSPECTION and nothing else. */
const portalAccess = {
    resolveToken: async (token: string) => token === TOKEN
        ? { id: 'tok1', tenantId: TENANT, inspectionId: INSPECTION, role: 'client', recipientEmail: 'client@x.com', revokedAt: null, expiresAt: null }
        : null,
    resolveByEmailAndInspection: async () => null,
};

function buildApp(services: Svc, staff: { role: string; sub?: string } = { role: 'owner', sub: 'u1' }) {
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('services', { portalAccess, ...services } as unknown as HonoConfig['Variables']['services']);
        await next();
    });
    app.use('/api/inspections/*', async (c, next) => {
        c.set('tenantId', TENANT);
        c.set('userRole', staff.role as never);
        if (staff.sub) c.set('user', { sub: staff.sub, role: staff.role, tenantId: TENANT } as never);
        await next();
    });
    app.onError((err, c) => {
        if (err instanceof AppError) return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
        throw err;
    });
    app.route('/api/public', clientDocumentsRoutes);
    app.route('/api/public', clientMessageRoutes);
    app.route('/api/inspections', inspectorDocumentsRoutes);
    return app;
}

const env = { JWT_SECRET: 'test-jwt-secret' } as unknown as HonoConfig['Bindings'];
const call = (app: ReturnType<typeof buildApp>, path: string, init?: RequestInit) => app.request(path, init, env);
const docs = `/api/public/inspections/${INSPECTION}/documents`;
const msgs = `/api/public/inspections/${INSPECTION}/messages`;
const post = (body: string) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body });

describe('client documents (OpenAPI list and delete)', () => {
    it('GET list answers 401 {error} without a grant and never reads the service', async () => {
        const list = vi.fn();
        const res = await call(buildApp({ clientDocument: { list } }), docs);
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: 'Unauthorized' });
        expect(list).not.toHaveBeenCalled();
    });

    it('GET list returns exactly the client-facing fields, hides inspector-internal rows and never leaks the storage key', async () => {
        const list = vi.fn().mockResolvedValue([
            row(),
            row({ id: 'd2', uploadedByKind: 'inspector', uploadedByRef: 'u1', visibility: 'internal' }),
            row({ id: 'd3', uploadedByKind: 'inspector', uploadedByRef: 'u1', visibility: 'client_visible', filename: 'shared.pdf' }),
        ]);
        const res = await call(buildApp({ clientDocument: { list } }), `${docs}?token=${TOKEN}`);
        expect(res.status).toBe(200);
        const body = await res.json() as { data: Array<Record<string, unknown>> };
        expect(body.data.map((d) => d.id)).toEqual(['d1', 'd3']);
        expect(Object.keys(body.data[0]!).sort()).toEqual(
            ['category', 'createdAt', 'filename', 'id', 'isOwn', 'label', 'sizeBytes', 'uploadedByKind', 'uploadedByName', 'visibility'],
        );
        expect(body.data[0]).toMatchObject({ isOwn: true, createdAt: '2026-06-01T00:00:00.000Z', label: null });
        expect(body.data[1]).toMatchObject({ isOwn: false });
        expect(list).toHaveBeenCalledWith(TENANT, INSPECTION);
    });

    it('DELETE answers 401, 404 and 403 with the {error} bodies and removes nothing', async () => {
        const remove = vi.fn();
        const get = vi.fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(row({ inspectionId: 'other' }))
            .mockResolvedValueOnce(row({ uploadedByRef: 'someone@else.com' }));
        const app = buildApp({ clientDocument: { get, remove } });
        const del = (query: string) => call(app, `${docs}/d1${query}`, { method: 'DELETE' });

        const denied = await del('');
        expect(denied.status).toBe(401);
        expect(await denied.json()).toEqual({ error: 'Unauthorized' });
        expect(get).not.toHaveBeenCalled();

        for (const [status, error] of [[404, 'Not found'], [404, 'Not found'], [403, 'Forbidden']] as const) {
            const res = await del(`?token=${TOKEN}`);
            expect(res.status).toBe(status);
            expect(await res.json()).toEqual({ error });
        }
        expect(remove).not.toHaveBeenCalled();
    });

    it('DELETE of the caller own upload removes it and answers {data:{ok:true}}', async () => {
        const remove = vi.fn().mockResolvedValue(undefined);
        const get = vi.fn().mockResolvedValue(row());
        const res = await call(buildApp({ clientDocument: { get, remove } }), `${docs}/d1?token=${TOKEN}`, { method: 'DELETE' });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ data: { ok: true } });
        expect(remove).toHaveBeenCalledWith(TENANT, 'd1');
    });

    it('the plain upload and download handlers still answer next to the OpenAPI routes (401 without a grant)', async () => {
        const app = buildApp({ clientDocument: {} });
        const put = await call(app, `${docs}?filename=a.pdf&category=other`, { method: 'PUT', headers: { 'content-type': 'application/pdf', 'content-length': '1' }, body: new Uint8Array([1]) });
        expect(put.status).toBe(401);
        expect(await put.json()).toEqual({ error: 'Unauthorized' });
        const badQuery = await call(app, docs, { method: 'PUT', body: new Uint8Array([1]) });
        expect(badQuery.status).toBe(400);
        expect((await call(app, `${docs}/d1`)).status).toBe(401);
    });
});

describe('inspector documents (OpenAPI list and delete)', () => {
    const base = `/api/inspections/${INSPECTION}/documents`;

    it('GET list returns every row including internal ones, with the uploader reference', async () => {
        const list = vi.fn().mockResolvedValue([row(), row({ id: 'd2', uploadedByKind: 'inspector', uploadedByRef: 'u1', visibility: 'internal' })]);
        const res = await call(buildApp({ clientDocument: { list } }, { role: 'inspector', sub: 'u1' }), base);
        expect(res.status).toBe(200);
        const body = await res.json() as { data: Array<Record<string, unknown>> };
        expect(body.data.map((d) => d.id)).toEqual(['d1', 'd2']);
        expect(Object.keys(body.data[1]!).sort()).toEqual(
            ['category', 'createdAt', 'filename', 'id', 'label', 'sizeBytes', 'uploadedByKind', 'uploadedByName', 'uploadedByRef', 'visibility'],
        );
        expect(list).toHaveBeenCalledWith(TENANT, INSPECTION);
    });

    it('GET list answers 401 {error} when the JWT context has no user', async () => {
        const list = vi.fn();
        const res = await call(buildApp({ clientDocument: { list } }, { role: 'inspector' }), base);
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: 'Unauthorized' });
        expect(list).not.toHaveBeenCalled();
    });

    it('DELETE is refused for an agent before the service is touched, and works for owner, manager and inspector', async () => {
        const get = vi.fn().mockResolvedValue(row());
        const remove = vi.fn().mockResolvedValue(undefined);
        const refused = await call(buildApp({ clientDocument: { get, remove } }, { role: 'agent', sub: 'u9' }), `${base}/d1`, { method: 'DELETE' });
        expect(refused.status).toBe(403);
        expect(get).not.toHaveBeenCalled();
        expect(remove).not.toHaveBeenCalled();
        for (const role of ['owner', 'manager', 'inspector']) {
            const res = await call(buildApp({ clientDocument: { get, remove } }, { role, sub: 'u1' }), `${base}/d1`, { method: 'DELETE' });
            expect(res.status).toBe(200);
            expect(await res.json()).toEqual({ data: { ok: true } });
        }
        expect(remove).toHaveBeenCalledTimes(3);
        expect(remove).toHaveBeenCalledWith(TENANT, 'd1');
    });

    it('DELETE answers 404 {error} for a document that belongs to another inspection', async () => {
        const remove = vi.fn();
        const get = vi.fn().mockResolvedValue(row({ inspectionId: 'other' }));
        const res = await call(buildApp({ clientDocument: { get, remove } }), `${base}/d1`, { method: 'DELETE' });
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: 'Not found' });
        expect(remove).not.toHaveBeenCalled();
    });

    it('the plain upload still enforces the role gate next to the OpenAPI routes', async () => {
        const res = await call(buildApp({ clientDocument: {} }, { role: 'agent', sub: 'u9' }), `${base}?filename=a.pdf&category=other`, { method: 'PUT', body: new Uint8Array([1]) });
        expect(res.status).toBe(403);
    });
});

describe('client messages (OpenAPI list and send)', () => {
    const thread = { contactId: 'c1', name: 'Pat Client', email: 'client@x.com' };
    const stored = { id: 'm1', contactId: 'c1', fromRole: 'client', body: 'hello' };

    it('GET answers 401 {error} without a grant and does not read the thread', async () => {
        const listForInspection = vi.fn();
        const res = await call(buildApp({ message: { listForInspection } }), msgs);
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: 'Unauthorized' });
        expect(listForInspection).not.toHaveBeenCalled();
    });

    it('GET returns only the caller thread and marks that thread read', async () => {
        const message = {
            resolveThreadContact: vi.fn().mockResolvedValue(thread),
            listForInspection: vi.fn().mockResolvedValue([{ id: 'm1', contactId: 'c1' }, { id: 'm2', contactId: 'c2' }]),
            markThreadReadForContact: vi.fn().mockResolvedValue(undefined),
        };
        const res = await call(buildApp({ message }), `${msgs}?token=${TOKEN}`);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ success: true, data: [{ id: 'm1', contactId: 'c1' }] });
        expect(message.resolveThreadContact).toHaveBeenCalledWith(TENANT, INSPECTION, 'client@x.com');
        expect(message.markThreadReadForContact).toHaveBeenCalledWith(TENANT, 'c1', INSPECTION);
    });

    it('GET without a seat returns the whole list and marks nothing', async () => {
        const message = {
            resolveThreadContact: vi.fn().mockResolvedValue(null),
            listForInspection: vi.fn().mockResolvedValue([{ id: 'm1', contactId: 'c1' }, { id: 'm2', contactId: 'c2' }]),
            markThreadReadForContact: vi.fn(),
        };
        const res = await call(buildApp({ message }), `${msgs}?token=${TOKEN}`);
        expect((await res.json() as { data: unknown[] }).data).toHaveLength(2);
        expect(message.markThreadReadForContact).not.toHaveBeenCalled();
    });

    it('POST checks the actor before the body: a bad body without a grant is 401, not 400', async () => {
        const res = await call(buildApp({ message: {} }), msgs, post('not json'));
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: 'Unauthorized' });
    });

    it('POST answers 400 {error} for malformed JSON, an empty body and an over-long body, and creates nothing', async () => {
        const createMessage = vi.fn();
        const app = buildApp({ message: { createMessage, resolveThreadContact: vi.fn().mockResolvedValue(thread) } });
        for (const body of ['not json', JSON.stringify({ body: '' }), JSON.stringify({ body: 'x'.repeat(5001) }), 'null']) {
            const res = await call(app, `${msgs}?token=${TOKEN}`, post(body));
            expect(res.status).toBe(400);
            expect(await res.json()).toEqual({ error: 'Invalid message payload.' });
        }
        expect(createMessage).not.toHaveBeenCalled();
    });

    it('POST answers 403 {error} when the caller has no client seat', async () => {
        const createMessage = vi.fn();
        const app = buildApp({ message: { createMessage, resolveThreadContact: vi.fn().mockResolvedValue(null) } });
        const res = await call(app, `${msgs}?token=${TOKEN}`, post(JSON.stringify({ body: 'hi' })));
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: 'No client seat on this inspection.' });
        expect(createMessage).not.toHaveBeenCalled();
    });

    it('POST creates the message as the caller seat, notifies the inspector and answers 201 with the row', async () => {
        const createMessage = vi.fn().mockResolvedValue(stored);
        const sendMessageNotification = vi.fn().mockRejectedValue(new Error('mail is down'));
        const app = buildApp({
            message: { createMessage, resolveThreadContact: vi.fn().mockResolvedValue(thread) },
            email: { sendMessageNotification },
        });
        const res = await call(app, `${msgs}?token=${TOKEN}`, post(JSON.stringify({ body: 'hello' })));
        expect(res.status).toBe(201);
        expect(await res.json()).toEqual({ success: true, data: stored });
        expect(createMessage).toHaveBeenCalledWith({
            tenantId: TENANT, inspectionId: INSPECTION, contactId: 'c1', fromRole: 'client', fromName: 'Pat Client', body: 'hello', attachments: [],
        });
        expect(sendMessageNotification).toHaveBeenCalledTimes(1);
    });

    it('the plain upload and attachment handlers still answer next to the OpenAPI routes (401 without a grant)', async () => {
        const app = buildApp({ message: {} });
        expect((await call(app, `${msgs}/upload`, { method: 'POST' })).status).toBe(401);
        const att = await call(app, `${msgs}/attachments/a1`);
        expect(att.status).toBe(401);
        expect(await att.json()).toEqual({ error: 'Unauthorized' });
    });
});

describe('operations in the OpenAPI document', () => {
    const doc = buildOpenApiDocument(buildApp({}), { openapi: '3.0.0', info: { version: 'test', title: 't' } });
    const op = (path: string, method: string) => (doc.paths?.[path] as Record<string, Record<string, unknown>> | undefined)?.[method];

    it('lists the six operations with their ids', () => {
        expect(op('/api/public/inspections/{id}/documents', 'get')?.operationId).toBe('listClientDocuments');
        expect(op('/api/public/inspections/{id}/documents/{docId}', 'delete')?.operationId).toBe('deleteClientDocument');
        expect(op('/api/inspections/{id}/documents', 'get')?.operationId).toBe('listInspectionDocuments');
        expect(op('/api/inspections/{id}/documents/{docId}', 'delete')?.operationId).toBe('deleteInspectionDocument');
        expect(op('/api/public/inspections/{id}/messages', 'get')?.operationId).toBe('listClientMessages');
        expect(op('/api/public/inspections/{id}/messages', 'post')?.operationId).toBe('sendClientMessage');
    });

    it('keeps the portal-token routes out of MCP and declares no security for them', () => {
        for (const [path, method] of [
            ['/api/public/inspections/{id}/documents', 'get'],
            ['/api/public/inspections/{id}/documents/{docId}', 'delete'],
            ['/api/public/inspections/{id}/messages', 'get'],
            ['/api/public/inspections/{id}/messages', 'post'],
        ] as const) {
            expect(op(path, method)?.['x-tier']).toBe('excluded');
            expect(op(path, method)?.['x-scopes']).toEqual([]);
            expect(op(path, method)?.security).toBeUndefined();
        }
    });

    it('exposes the staff routes as extended: read for the list, write for the delete', () => {
        expect(op('/api/inspections/{id}/documents', 'get')).toMatchObject({ 'x-tier': 'extended', 'x-scopes': ['read'] });
        expect(op('/api/inspections/{id}/documents/{docId}', 'delete')).toMatchObject({ 'x-tier': 'extended', 'x-scopes': ['write'] });
    });

    it('does not list the plain handlers', () => {
        expect(op('/api/public/inspections/{id}/documents', 'put')).toBeUndefined();
        expect(op('/api/public/inspections/{id}/messages/upload', 'post')).toBeUndefined();
    });
});
