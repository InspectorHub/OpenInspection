import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import publicReportRoutes from '../../../server/api/public-report';
import type { HonoConfig } from '../../../server/types/hono';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { eq, asc } from 'drizzle-orm';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { InspectionService } from '../../../server/services/inspection.service';
import { AgreementService } from '../../../server/services/agreement.service';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

/**
 * C-10 ③-A.1 — GET /api/public/report/:tenant/:id integration shape.
 * Public, no-login: token gates access; tenantId comes from the token row,
 * never the URL. We stub portalAccess.resolveToken + inspection.getReportData.
 */
describe('GET /api/public/report/:tenant/:id — ③-A.1', () => {
    const tokenRow = (over: Partial<Record<string, unknown>> = {}) => ({
        inspectionId: 'insp1', tenantId: 't1', role: 'client', recipientEmail: 'a@b.com',
        revokedAt: null, expiresAt: null, ...over,
    });

    function buildApp(
        resolveToken: ReturnType<typeof vi.fn>,
        getReportData = vi.fn().mockResolvedValue({ inspectionId: 'insp1' }),
        resolveAgentViewToken = vi.fn().mockResolvedValue(null),
    ) {
        // The publish gate added to reportRoute runs drizzle(c.env.DB).select()...get()
        // on the resolved (client/legacy) path. These cases all use published
        // reports, so the chainable fake resolves to report_status='published' and
        // the gate lets them through (the 404 cases bail before the gate).
        const publishedDb = { select: () => ({ from: () => ({ where: () => ({ get: async () => ({ reportStatus: 'published' }) }) }) }) };
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(publishedDb as any);
        const app = new OpenAPIHono<HonoConfig>();
        app.use('*', async (c, next) => {
            (c as unknown as { env: Record<string, unknown> }).env = { DB: {} };
            c.set('services', { portalAccess: { resolveToken }, inspection: { getReportData, resolveAgentViewToken } } as unknown as HonoConfig['Variables']['services']);
            await next();
        });
        app.route('/api/public', publicReportRoutes);
        return { app, getReportData };
    }

    it('404 when no token', async () => {
        const { app } = buildApp(vi.fn());
        const res = await app.request('/api/public/report/t/insp1');
        expect(res.status).toBe(404);
    });

    it('404 when the token maps to a different inspection', async () => {
        const { app } = buildApp(vi.fn().mockResolvedValue(tokenRow({ inspectionId: 'other' })));
        const res = await app.request('/api/public/report/t/insp1?token=tok');
        expect(res.status).toBe(404);
    });

    it('200 via the legacy KV agent-view-token fallback (existing share links)', async () => {
        const getReportData = vi.fn().mockResolvedValue({ inspectionId: 'insp1' });
        const legacy = vi.fn().mockResolvedValue({ inspectionId: 'insp1', tenantId: 't9' });
        const { app } = buildApp(vi.fn().mockResolvedValue(null), getReportData, legacy);
        const res = await app.request('/api/public/report/t/insp1?token=kvtok');
        expect(res.status).toBe(200);
        // Third arg: the makePhotoUrl factory added by A-9 (photo serve routes).
        expect(getReportData).toHaveBeenCalledWith('insp1', 't9', expect.any(Function), expect.any(Object));
    });

    it('200 with report data + queries by the token tenantId (not the URL)', async () => {
        const { app, getReportData } = buildApp(vi.fn().mockResolvedValue(tokenRow()));
        const res = await app.request('/api/public/report/WRONG-TENANT/insp1?token=tok');
        expect(res.status).toBe(200);
        const body = await res.json() as { success: boolean; data: unknown };
        expect(body.success).toBe(true);
        // Third arg: the makePhotoUrl factory added by A-9 (photo serve routes).
        expect(getReportData).toHaveBeenCalledWith('insp1', 't1', expect.any(Function), expect.any(Object));
    });
});

/**
 * C-10 ③-A.4 — GET /api/public/observe/inspections/:id?token=
 * Live observer view, gated by an OBSERVER-link token (distinct from the portal
 * token). tenantId comes from the claimed observer link, never the URL.
 */
describe('GET /api/public/observe/inspections/:id — ③-A.4', () => {
    function buildApp(
        claim: ReturnType<typeof vi.fn>,
        getObserveProgress = vi.fn().mockResolvedValue({
            address: '1 Main St', date: '2026-06-01', inspectorName: 'Pat', status: 'completed', sections: [],
        }),
    ) {
        const app = new OpenAPIHono<HonoConfig>();
        app.use('*', async (c, next) => {
            c.set('services', { observerLink: { claim }, inspection: { getObserveProgress } } as unknown as HonoConfig['Variables']['services']);
            await next();
        });
        app.route('/api/public', publicReportRoutes);
        return { app, getObserveProgress };
    }

    it('404 when no token', async () => {
        const { app } = buildApp(vi.fn());
        const res = await app.request('/api/public/observe/inspections/insp1');
        expect(res.status).toBe(404);
    });

    it('404 when the observer link is not claimable', async () => {
        const { app } = buildApp(vi.fn().mockResolvedValue({ kind: 'expired' }));
        const res = await app.request('/api/public/observe/inspections/insp1?token=tok');
        expect(res.status).toBe(404);
    });

    it('404 when the token claims a different inspection', async () => {
        const { app } = buildApp(vi.fn().mockResolvedValue({ kind: 'ok', inspectionId: 'other', tenantId: 't1' }));
        const res = await app.request('/api/public/observe/inspections/insp1?token=tok');
        expect(res.status).toBe(404);
    });

    it('200 with progress + queries by the claimed tenantId (not the URL)', async () => {
        const { app, getObserveProgress } = buildApp(
            vi.fn().mockResolvedValue({ kind: 'ok', inspectionId: 'insp1', tenantId: 't1' }),
        );
        const res = await app.request('/api/public/observe/inspections/insp1?token=tok');
        expect(res.status).toBe(200);
        const body = await res.json() as { success: boolean; data: { address: string } };
        expect(body.success).toBe(true);
        expect(body.data.address).toBe('1 Main St');
        expect(getObserveProgress).toHaveBeenCalledWith('insp1', 't1');
    });
});

/**
 * C-10 ③-A.2 — GET /api/public/report-gate/:tenant/:id
 * Public "report blocked, here's why + CTA" page. tenantId resolves from the
 * slug (middleware), never the URL :tenant. No token (pre-report).
 */
describe('GET /api/public/report-gate/:tenant/:id — ③-A.2', () => {
    function buildApp(
        tenantId: string | null,
        getReportGate = vi.fn().mockResolvedValue({
            reason: 'payment', companyName: 'Acme', primaryColor: '#123456',
            actionUrl: '/invoice/insp1', actionLabel: 'Pay invoice',
            propertyAddress: '1 Main St', inspectorName: 'Pat', inspectorEmail: null,
            inspectorPhone: null, inspectorLicense: null, scheduledDate: '2026-06-01',
            amountCents: 45000, currency: 'USD',
        }),
    ) {
        const app = new OpenAPIHono<HonoConfig>();
        app.use('*', async (c, next) => {
            if (tenantId) c.set('tenantId', tenantId);
            c.set('services', { inspection: { getReportGate } } as unknown as HonoConfig['Variables']['services']);
            await next();
        });
        app.route('/api/public', publicReportRoutes);
        return { app, getReportGate };
    }

    it('404 when the tenant slug does not resolve', async () => {
        const { app } = buildApp(null);
        const res = await app.request('/api/public/report-gate/acme/insp1');
        expect(res.status).toBe(404);
    });

    it('200 with the gate payload + queries by the resolved tenantId (not the URL)', async () => {
        const { app, getReportGate } = buildApp('t1');
        const res = await app.request('/api/public/report-gate/WRONG-TENANT/insp1');
        expect(res.status).toBe(200);
        const body = await res.json() as { success: boolean; data: { reason: string; amountCents: number } };
        expect(body.success).toBe(true);
        expect(body.data.reason).toBe('payment');
        expect(body.data.amountCents).toBe(45000);
        // Task 7 — the route now threads the agreement service through as the
        // 4th arg (undefined here since this stub omits it).
        expect(getReportGate).toHaveBeenCalledWith('insp1', 't1', 'WRONG-TENANT', undefined);
    });
});

/**
 * Track I-a Task 7 — getReportGate combined-checkout routing (real DB).
 * When BOTH the agreement and payment gates are outstanding, the gate's CTA
 * points at the combined /checkout/{slug}/{signerToken} page ('Sign & pay'),
 * with `reason` staying 'agreement' for compat. Single-outstanding behaviors
 * stay byte-compatible (/agreements/sign and /invoice/:id URLs).
 */
describe('InspectionService.getReportGate — combined checkout routing (Task 7)', () => {
    const TENANT_ID = '00000000-0000-0000-0000-000000000001';
    const INSP_ID = '00000000-0000-0000-0000-000000000010';
    const AGR_ID = '00000000-0000-0000-0000-000000000020';
    const SLUG = 'acme';
    const JWT_SECRET = 'test-secret';

    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: any;

    async function seed(inspOver: Partial<typeof schema.inspections.$inferInsert> = {}) {
        await db.insert(schema.tenants).values({
            id: TENANT_ID, name: 'Acme', slug: SLUG, status: 'active',
            deploymentMode: 'shared', tier: 'free', maxUsers: 5, createdAt: new Date(),
        } as any);
        await db.insert(schema.tenantConfigs).values({
            tenantId: TENANT_ID, companyName: 'Acme Inspections', primaryColor: '#ff5500', updatedAt: new Date(),
        } as any);
        await db.insert(schema.inspections).values({
            id: INSP_ID, tenantId: TENANT_ID, propertyAddress: '1 Main St', clientName: 'Jane',
            clientEmail: 'jane@test.com', date: '2026-06-01', status: 'requested', paymentStatus: 'unpaid',
            price: 50000, agreementRequired: true, paymentRequired: true, createdAt: new Date(),
            ...inspOver,
        } as any);
        await db.insert(schema.agreements).values({
            id: AGR_ID, tenantId: TENANT_ID, name: 'Standard Agreement',
            content: 'ORIGINAL agreement text', version: 1, createdAt: new Date(),
        } as any);
    }

    async function createEnvelope() {
        const svc = new AgreementService({} as D1Database, { jwtSecret: JWT_SECRET });
        const r = await svc.findOrCreate(TENANT_ID, INSP_ID, {
            signers: [{ name: 'Jane', email: 'jane@test.com', role: 'client' }],
            completionPolicy: 'all',
        });
        const signers = await db.select().from(schema.agreementSigners)
            .where(eq(schema.agreementSigners.requestId, r.requestId))
            .orderBy(asc(schema.agreementSigners.createdAt)).all();
        return { token: r.token, requestId: r.requestId, signers };
    }

    function makeService() {
        const inspection = new InspectionService({} as D1Database);
        const agreement = new AgreementService({} as D1Database, { jwtSecret: JWT_SECRET });
        return { inspection, agreement };
    }

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db as BetterSQLite3Database<typeof schema>;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as any).mockReturnValue(db);
    });

    afterEach(() => sqlite.close());

    it('BOTH outstanding -> combined checkout URL + "Sign & pay", reason stays agreement', async () => {
        await seed({ agreementRequired: true, paymentRequired: true, paymentStatus: 'unpaid' });
        const { token, signers } = await createEnvelope();
        const { inspection, agreement } = makeService();

        const gate = await inspection.getReportGate(INSP_ID, TENANT_ID, SLUG, agreement);
        expect(gate).not.toBeNull();
        expect(gate!.reason).toBe('agreement');
        expect(gate!.actionLabel).toBe('Sign & pay');
        // The signer token in the URL is reconstructed server-side; it is the
        // SAME tier-2 token the public sign page uses (round-trips to the signer).
        expect(gate!.actionUrl).toBe(`/checkout/${SLUG}/${token}`);
        // Token in the URL resolves back to our signer.
        const resolved = await agreement.getSignerByPresentedToken(token);
        expect(resolved?.signer.id).toBe(signers[0].id);
    });

    it('ONLY agreement outstanding -> /agreements/sign URL carries the REAL signer token', async () => {
        await seed({ agreementRequired: true, paymentRequired: false, paymentStatus: 'unpaid' });
        const { token, signers } = await createEnvelope();
        const { inspection, agreement } = makeService();

        const gate = await inspection.getReportGate(INSP_ID, TENANT_ID, SLUG, agreement);
        expect(gate!.reason).toBe('agreement');
        expect(gate!.actionLabel).toBe('Sign agreement');
        // The agreement-only sign URL must route through the first outstanding
        // signer's real tier-2 token — NOT the undistributed envelope placeholder.
        expect(gate!.actionUrl).toBe(`/agreements/sign/${SLUG}/${token}`);
        expect(gate!.actionUrl).not.toContain('/checkout/');
        // The token round-trips back to signer 1 (proves it is the signer link,
        // not the placeholder envelope token) and never carries a sentinel.
        expect(gate!.actionUrl).not.toContain('x:');
        const resolved = await agreement.getSignerByPresentedToken(token);
        expect(resolved?.signer.id).toBe(signers[0].id);
    });

    it('multi-signer agreement-only gate URL resolves to signer 1, never a sentinel', async () => {
        await seed({ agreementRequired: true, paymentRequired: false, paymentStatus: 'unpaid' });
        // Two-signer envelope: the gate must route to signer 1's real token.
        const svc = new AgreementService({} as D1Database, { jwtSecret: JWT_SECRET });
        const r = await svc.findOrCreate(TENANT_ID, INSP_ID, {
            signers: [
                { name: 'Jane', email: 'jane@test.com', role: 'client' },
                { name: 'John', email: 'john@test.com', role: 'co_client' },
            ],
            completionPolicy: 'all',
        });
        const signers = await db.select().from(schema.agreementSigners)
            .where(eq(schema.agreementSigners.requestId, r.requestId))
            .orderBy(asc(schema.agreementSigners.createdAt)).all();
        const { inspection, agreement } = makeService();

        const gate = await inspection.getReportGate(INSP_ID, TENANT_ID, SLUG, agreement);
        expect(gate!.reason).toBe('agreement');
        const urlToken = gate!.actionUrl.split('/').pop()!;
        expect(urlToken).not.toContain('x:');
        const resolved = await agreement.getSignerByPresentedToken(urlToken);
        expect(resolved?.signer.id).toBe(signers[0].id);
    });

    it('ONLY payment outstanding -> /invoice/:id URL', async () => {
        await seed({ agreementRequired: false, paymentRequired: true, paymentStatus: 'unpaid' });
        const { inspection, agreement } = makeService();

        const gate = await inspection.getReportGate(INSP_ID, TENANT_ID, SLUG, agreement);
        expect(gate!.reason).toBe('payment');
        expect(gate!.actionLabel).toBe('Pay invoice');
        expect(gate!.actionUrl).toBe(`/invoice/${INSP_ID}`);
    });

    // Phase B — the gate surfaces the INVOICE's snapshot currency, not the
    // tenant's live setting. seed() leaves tenant_configs.currency at its default
    // ('USD'); the invoice is stamped 'CAD', and the gate must report 'CAD'.
    it('payment gate reports the invoice snapshot currency, not the tenant setting', async () => {
        await seed({ agreementRequired: false, paymentRequired: true, paymentStatus: 'unpaid' });
        await db.insert(schema.invoices).values({
            id: '00000000-0000-0000-0000-0000000000f1', tenantId: TENANT_ID, inspectionId: INSP_ID,
            amountCents: 50000, currency: 'CAD', lineItems: [], createdAt: new Date(),
        } as any);
        const { inspection, agreement } = makeService();

        const gate = await inspection.getReportGate(INSP_ID, TENANT_ID, SLUG, agreement);
        expect(gate!.amountCents).toBe(50000);
        expect(gate!.currency).toBe('CAD');
    });
});

/**
 * Photo-guard prefix migration — GET /api/public/report/:tenant/:id/photo
 *
 * The key guard (startsWith) must use the NEW `{tenantId}/inspections/{id}/`
 * prefix (post r2-key-convention). This suite asserts that:
 *   • a new-convention photo/cover key passes the guard (object is served)
 *   • a key scoped to a foreign tenant is 404'd
 *   • a key scoped to the right tenant but a different inspection is 404'd
 *
 * Auth is wired via a stub portalAccess.resolveToken that returns the fixed
 * tenantId so the test focuses exclusively on the prefix guard, not auth.
 */
describe('GET /api/public/report/:tenant/:id/photo — prefix guard (r2-key-convention)', () => {
    const TENANT = 't1';
    const INSP = 'insp1';

    /** A fake R2 object that satisfies the minimal interface the handler reads. */
    function fakeR2Object() {
        return {
            body: new ReadableStream(),
            httpMetadata: { contentType: 'image/jpeg' },
            customMetadata: {},
            httpEtag: 'etag',
        };
    }

    function buildApp(key: string, mockPhotos: Record<string, ReturnType<typeof fakeR2Object> | null> = {}) {
        // portalAccess.resolveToken returns a valid row for our fixed tenant/inspection.
        const resolveToken = vi.fn().mockResolvedValue({
            inspectionId: INSP, tenantId: TENANT, role: 'client',
            recipientEmail: 'a@b.com', revokedAt: null, expiresAt: null,
        });
        // drizzle is mocked globally; the handler calls it twice:
        // (1) legacy agent-view-token path — irrelevant here (resolveToken already hits)
        // (2) photoGate: returns published so the report-status gate passes.
        const publishedDb = {
            select: () => ({ from: () => ({ where: () => ({ get: async () => ({ reportStatus: 'published' }) }) }) }),
        };
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(publishedDb as any);

        const app = new OpenAPIHono<HonoConfig>();
        app.use('*', async (c, next) => {
            (c as unknown as { env: Record<string, unknown> }).env = {
                DB: {},
                PHOTOS: {
                    get: async (k: string) => mockPhotos[k] ?? null,
                },
            };
            c.set('services', {
                portalAccess: { resolveToken },
                inspection: { resolveAgentViewToken: vi.fn().mockResolvedValue(null) },
            } as unknown as HonoConfig['Variables']['services']);
            await next();
        });
        app.route('/api/public', publicReportRoutes);
        return app;
    }

    it('new-convention photo key passes the guard (served, not 404)', async () => {
        const key = `${TENANT}/inspections/${INSP}/photos/media-uuid.jpg`;
        const app = buildApp(key, { [key]: fakeR2Object() });
        const res = await app.request(
            `/api/public/report/acme/${INSP}/photo?key=${encodeURIComponent(key)}&token=tok`,
        );
        // 200 means the guard passed and the object was found + served.
        expect(res.status).toBe(200);
    });

    it('new-convention cover key passes the guard (served, not 404)', async () => {
        const key = `${TENANT}/inspections/${INSP}/cover/media-uuid.jpg`;
        const app = buildApp(key, { [key]: fakeR2Object() });
        const res = await app.request(
            `/api/public/report/acme/${INSP}/photo?key=${encodeURIComponent(key)}&token=tok`,
        );
        expect(res.status).toBe(200);
    });

    it('key scoped to a foreign tenant is 404d by the prefix guard', async () => {
        const key = `OTHER-TENANT/inspections/${INSP}/photos/media-uuid.jpg`;
        const app = buildApp(key, { [key]: fakeR2Object() });
        const res = await app.request(
            `/api/public/report/acme/${INSP}/photo?key=${encodeURIComponent(key)}&token=tok`,
        );
        expect(res.status).toBe(404);
    });

    it('key scoped to the right tenant but a different inspection is 404d by the prefix guard', async () => {
        const key = `${TENANT}/inspections/OTHER-INSP/photos/media-uuid.jpg`;
        const app = buildApp(key, { [key]: fakeR2Object() });
        const res = await app.request(
            `/api/public/report/acme/${INSP}/photo?key=${encodeURIComponent(key)}&token=tok`,
        );
        expect(res.status).toBe(404);
    });

    it('OLD bare prefix key (tenantId/inspId/) is rejected by the updated guard', async () => {
        // This is the regression case: the old guard `${tenantId}/${id}/` would
        // have passed this key; the new guard must not.
        const key = `${TENANT}/${INSP}/photos/media-uuid.jpg`;
        const app = buildApp(key, { [key]: fakeR2Object() });
        const res = await app.request(
            `/api/public/report/acme/${INSP}/photo?key=${encodeURIComponent(key)}&token=tok`,
        );
        expect(res.status).toBe(404);
    });
});
