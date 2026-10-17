/**
 * A signed agreement, its certificate, its evidence pack and the inspector pre-sign are addressed by the
 * envelope's own id, so the inspection path guard never sees them. Each must treat an envelope as visible
 * only when the inspection it belongs to is, and answer the same 404 an unknown envelope gets.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { createTestDb, setupSchema } from '../db';
import { asD1DrizzleReturn, asScopedDbSource } from '../helpers/test-db';
import * as schema from '../../../server/lib/db/schema';
import { ScopedDB } from '../../../server/lib/db/scoped';
import evidenceRoutes from '../../../server/api/evidence';
import adminAgreementsRoutes from '../../../server/api/admin/admin-agreements';
import { AppError } from '../../../server/lib/errors';
import { seedVisibilityFixture, TENANT, USERS, INSP } from '../helpers/visibility-fixture';
import type { HonoConfig } from '../../../server/types/hono';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

type Role = 'owner' | 'manager' | 'inspector';
const AGR = 'agr-1';
const ENV = { own: 'env-own', other: 'env-other' } as const;

describe('agreement envelopes follow the visibility of their inspection', () => {
    let db: ReturnType<typeof createTestDb>['db'];
    let r2Get: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        const f = createTestDb(); db = f.db; await setupSchema(f.sqlite); await seedVisibilityFixture(db);
        vi.mocked(drizzle).mockReturnValue(asD1DrizzleReturn(db));
        await db.insert(schema.agreements).values({ id: AGR, tenantId: TENANT, name: 'A', content: 'x', version: 1, createdAt: new Date() } as never);
        const env = (id: string, inspectionId: string) => ({
            id, tenantId: TENANT, inspectionId, agreementId: AGR, clientEmail: 'c@example.test', status: 'signed', signedAt: new Date(), createdAt: new Date(),
        });
        await db.insert(schema.agreementRequests).values([env(ENV.own, INSP.own), env(ENV.other, INSP.other)] as never);
        r2Get = vi.fn(async () => ({ body: new Blob(['pdf']).stream() }));
    });

    function build(userId: string, role: Role, mount: string, router: unknown) {
        const app = new OpenAPIHono<HonoConfig>();
        app.onError((err, c) => err instanceof AppError
            ? c.json({ success: false, error: { code: err.code, message: err.message } }, err.status)
            : c.json({ success: false, error: { message: String(err) } }, 500));
        app.use('*', async (c, next) => {
            c.set('userRole', role);
            c.set('user', { sub: userId, role, tenantId: TENANT } as never);
            c.set('tenantId', TENANT);
            c.set('sdb', new ScopedDB(asScopedDbSource(db), TENANT));
            await next();
        });
        app.route(mount, router as never);
        return app;
    }
    const get = (app: OpenAPIHono<HonoConfig>, p: string) => app.request(p, undefined, { DB: {}, JWT_SECRET: 'x', PHOTOS: { get: r2Get } } as never);

    for (const file of ['pdf', 'certificate.pdf', 'evidence.zip']) {
        it(`${file}: a restricted inspector gets 404 for an envelope of an inspection outside their set, and nothing is read from storage`, async () => {
            const app = build(USERS.inspA, 'inspector', '/api/admin', evidenceRoutes);
            const res = await get(app, `/api/admin/agreement-requests/${ENV.other}/${file}`);
            expect(res.status).toBe(404);
            expect(r2Get).not.toHaveBeenCalled();
        });
        it(`${file}: control, the same caller opens an envelope of their own inspection; an owner and an unrestricted inspector open both`, async () => {
            const mine = await get(build(USERS.inspA, 'inspector', '/api/admin', evidenceRoutes), `/api/admin/agreement-requests/${ENV.own}/${file}`);
            expect(mine.status).toBe(200);
            for (const [u, role] of [[USERS.owner, 'owner'], [USERS.inspAll, 'inspector']] as const) {
                const other = await get(build(u, role, '/api/admin', evidenceRoutes), `/api/admin/agreement-requests/${ENV.other}/${file}`);
                expect(other.status, u).toBe(200);
            }
        });
    }

    it('inspector pre-sign: a restricted inspector cannot sign an envelope outside their set, and nothing is written', async () => {
        const app = build(USERS.inspA, 'inspector', '/api/admin', adminAgreementsRoutes);
        await db.update(schema.agreementRequests).set({ status: 'pending' });
        const res = await app.request(`/api/admin/agreement-requests/${ENV.other}/inspector-sign`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ signatureBase64: `data:image/png;base64,${'A'.repeat(80)}` }),
        }, { DB: {}, JWT_SECRET: 'x' } as never);
        expect(res.status).toBe(404);
        const row = await db.select().from(schema.agreementRequests).where(eq(schema.agreementRequests.id, ENV.other)).get();
        expect(row?.inspectorSignatureBase64 ?? null).toBeNull();
    });

    it('inspector pre-sign: control, the same call on an envelope inside their set is not refused as missing', async () => {
        const app = build(USERS.inspA, 'inspector', '/api/admin', adminAgreementsRoutes);
        await db.update(schema.agreementRequests).set({ status: 'pending' });
        const res = await app.request(`/api/admin/agreement-requests/${ENV.own}/inspector-sign`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ signatureBase64: `data:image/png;base64,${'A'.repeat(80)}` }),
        }, { DB: {}, JWT_SECRET: 'x' } as never);
        expect(res.status).not.toBe(404);
        const row = await db.select().from(schema.agreementRequests).where(eq(schema.agreementRequests.id, ENV.own)).get();
        expect(row?.inspectorSignatureBase64).not.toBeNull();
    });
});
