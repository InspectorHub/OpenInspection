import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

// Both ClientDocumentService and PortalAccessService build their drizzle handle
// via `drizzle(this.db)` (drizzle-orm/d1). Mock that factory to hand back the
// in-memory better-sqlite3 test DB (mirrors portal-routes.spec.ts).
vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

import { Hono } from 'hono';
import type { HonoConfig } from '../../server/types/hono';
import { ClientDocumentService } from '../../server/services/client-document.service';
import { PortalAccessService } from '../../server/services/portal-access.service';
import { signPortalSession } from '../../server/lib/portal-session';
import clientDocumentsRoutes from '../../server/api/client-documents';

const TENANT = '00000000-0000-0000-0000-0000000000a1';
const SECRET = 'test-jwt-secret';

// Map-backed fake R2 bucket: supports put/get/delete. get() returns
// `{ body }` where body is a Uint8Array (good enough for `new Response(body)`).
function makeFakeBucket() {
    const store = new Map<string, Uint8Array>();
    return {
        async put(key: string, body: ReadableStream | Uint8Array | ArrayBuffer) {
            let bytes: Uint8Array;
            if (body instanceof Uint8Array) bytes = body;
            else if (body instanceof ArrayBuffer) bytes = new Uint8Array(body);
            else {
                // ReadableStream — drain it.
                const reader = (body as ReadableStream).getReader();
                const chunks: Uint8Array[] = [];
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    if (value) chunks.push(value as Uint8Array);
                }
                const total = chunks.reduce((n, c) => n + c.length, 0);
                bytes = new Uint8Array(total);
                let off = 0;
                for (const c of chunks) { bytes.set(c, off); off += c.length; }
            }
            store.set(key, bytes);
            return { key };
        },
        async get(key: string) {
            const bytes = store.get(key);
            if (!bytes) return null;
            return { body: bytes };
        },
        async delete(key: string) { store.delete(key); },
    } as unknown as R2Bucket;
}

describe('client document routes (token-gated)', () => {
    let testDb: BetterSQLite3Database<typeof schema>;

    async function seedInspection(id: string, overrides: Partial<typeof schema.inspections.$inferInsert> = {}) {
        await testDb.insert(schema.inspections).values({
            id,
            tenantId: TENANT,
            propertyAddress: `${id} Main St`,
            date: '2026-06-01',
            status: 'requested',
            reportStatus: 'in_progress',
            paymentStatus: 'unpaid',
            createdAt: new Date(),
            ...overrides,
        });
    }

    function buildApp(portalAccess: PortalAccessService, docs: ClientDocumentService) {
        const app = new Hono<HonoConfig>();
        app.use('*', async (c, next) => {
            c.set('services', {
                portalAccess,
                clientDocument: docs,
            } as unknown as HonoConfig['Variables']['services']);
            await next();
        });
        app.route('/api/public', clientDocumentsRoutes);
        return app;
    }

    function reqEnv() {
        return { JWT_SECRET: SECRET } as unknown as HonoConfig['Bindings'];
    }

    async function seedInspectionWithClientToken() {
        const inspectionId = 'insp1';
        await seedInspection(inspectionId);
        const portalAccess = new PortalAccessService({} as D1Database, { jwtSecret: SECRET });
        // Real tokens via issueToken so resolvePortalAccess(?token=) resolves.
        const clientEmail = 'client@x.com';
        const otherClientEmail = 'other@x.com';
        const clientToken = await portalAccess.issueToken({
            tenantId: TENANT, inspectionId, recipientEmail: clientEmail, role: 'client',
        });
        const otherClientToken = await portalAccess.issueToken({
            tenantId: TENANT, inspectionId, recipientEmail: otherClientEmail, role: 'co_client',
        });
        const docs = new ClientDocumentService({} as D1Database, makeFakeBucket());
        const app = buildApp(portalAccess, docs);
        return { app, inspectionId, clientToken, otherClientToken, clientEmail, otherClientEmail };
    }

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        await testDb.insert(schema.tenants).values({
            id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
    });

    it('PUT streams a valid file; bad extension → 400; no token → 401/403', async () => {
        const { app, inspectionId, clientToken } = await seedInspectionWithClientToken();
        const ok = await app.request(`/api/public/inspections/${inspectionId}/documents?filename=plan.pdf&category=plans_drawings&token=${clientToken}`,
            { method: 'PUT', headers: { 'content-type': 'application/pdf', 'content-length': '3' }, body: new Uint8Array([1, 2, 3]) }, reqEnv());
        expect(ok.status).toBe(200);
        const bad = await app.request(`/api/public/inspections/${inspectionId}/documents?filename=x.exe&category=other&token=${clientToken}`,
            { method: 'PUT', headers: { 'content-type': 'application/x-msdownload', 'content-length': '1' }, body: new Uint8Array([1]) }, reqEnv());
        expect(bad.status).toBe(400);
        const noTok = await app.request(`/api/public/inspections/${inspectionId}/documents?filename=a.pdf&category=other`,
            { method: 'PUT', headers: { 'content-type': 'application/pdf', 'content-length': '1' }, body: new Uint8Array([1]) }, reqEnv());
        expect([401, 403]).toContain(noTok.status);
    });

    it('rejects > 100MB via Content-Length with 413 before streaming', async () => {
        const { app, inspectionId, clientToken } = await seedInspectionWithClientToken();
        const res = await app.request(`/api/public/inspections/${inspectionId}/documents?filename=a.pdf&category=other&token=${clientToken}`,
            { method: 'PUT', headers: { 'content-type': 'application/pdf', 'content-length': String(101 * 1024 * 1024) }, body: new Uint8Array([1]) }, reqEnv());
        expect(res.status).toBe(413);
    });

    it('GET list hides internal from clients; GET download streams attachment + nosniff + original name', async () => {
        const { app, inspectionId, clientToken } = await seedInspectionWithClientToken();
        await app.request(`/api/public/inspections/${inspectionId}/documents?filename=My Report.pdf&category=prior_reports&token=${clientToken}`,
            { method: 'PUT', headers: { 'content-type': 'application/pdf', 'content-length': '3' }, body: new Uint8Array([1, 2, 3]) }, reqEnv());
        const list = await (await app.request(`/api/public/inspections/${inspectionId}/documents?token=${clientToken}`, {}, reqEnv())).json();
        expect(list.data.length).toBe(1);
        const docId = list.data[0].id;
        const dl = await app.request(`/api/public/inspections/${inspectionId}/documents/${docId}?token=${clientToken}`, {}, reqEnv());
        expect(dl.status).toBe(200);
        expect(dl.headers.get('content-disposition')).toMatch(/attachment/);
        expect(dl.headers.get('content-disposition')).toContain("filename*=UTF-8''My%20Report.pdf");
        expect(dl.headers.get('x-content-type-options')).toBe('nosniff');
    });

    it('GET list hides inspector-internal docs but shows inspector client_visible docs', async () => {
        const { app, inspectionId, clientToken } = await seedInspectionWithClientToken();
        // Seed two inspector-uploaded rows directly.
        const docs = new ClientDocumentService({} as D1Database, makeFakeBucket());
        await docs.create(TENANT, inspectionId, { kind: 'inspector', ref: 'u1', name: 'Inspector' },
            { filename: 'internal.pdf', contentType: 'application/pdf', category: 'other', visibility: 'internal', label: null, sizeBytes: 1 },
            new Uint8Array([1]));
        await docs.create(TENANT, inspectionId, { kind: 'inspector', ref: 'u1', name: 'Inspector' },
            { filename: 'shared.pdf', contentType: 'application/pdf', category: 'other', visibility: 'client_visible', label: null, sizeBytes: 1 },
            new Uint8Array([1]));
        const list = await (await app.request(`/api/public/inspections/${inspectionId}/documents?token=${clientToken}`, {}, reqEnv())).json();
        const names = list.data.map((d: { filename: string }) => d.filename).sort();
        expect(names).toEqual(['shared.pdf']);
        // r2Key must never be leaked.
        expect(list.data.every((d: Record<string, unknown>) => !('r2Key' in d))).toBe(true);
    });

    it('client can delete own but not another uploader file', async () => {
        const { app, inspectionId, clientToken, otherClientToken } = await seedInspectionWithClientToken();
        const put = await (await app.request(`/api/public/inspections/${inspectionId}/documents?filename=a.pdf&category=other&token=${clientToken}`,
            { method: 'PUT', headers: { 'content-type': 'application/pdf', 'content-length': '1' }, body: new Uint8Array([1]) }, reqEnv())).json();
        const id = put.data.id;
        const forbidden = await app.request(`/api/public/inspections/${inspectionId}/documents/${id}?token=${otherClientToken}`, { method: 'DELETE' }, reqEnv());
        expect([403, 404]).toContain(forbidden.status);
        const ok = await app.request(`/api/public/inspections/${inspectionId}/documents/${id}?token=${clientToken}`, { method: 'DELETE' }, reqEnv());
        expect(ok.status).toBe(200);
    });

    it('SESSION cookie path: GET list returns the client docs via resolveByEmailAndInspection', async () => {
        const { app, inspectionId, clientToken, clientEmail } = await seedInspectionWithClientToken();
        // Upload one doc via the token path.
        await app.request(`/api/public/inspections/${inspectionId}/documents?filename=mine.pdf&category=other&token=${clientToken}`,
            { method: 'PUT', headers: { 'content-type': 'application/pdf', 'content-length': '1' }, body: new Uint8Array([1]) }, reqEnv());
        // Now list with NO ?token — only the __Host-portal_session cookie.
        const cookie = await signPortalSession(SECRET, clientEmail);
        const res = await app.request(`/api/public/inspections/${inspectionId}/documents`, {
            headers: { cookie: '__Host-portal_session=' + cookie },
        }, reqEnv());
        expect(res.status).toBe(200);
        const list = await res.json();
        expect(list.data.length).toBe(1);
        expect(list.data[0].filename).toBe('mine.pdf');
    });
});
