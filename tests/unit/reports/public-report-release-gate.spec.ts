/**
 * F77 — the public report endpoints must honour the RELEASE gate, not only the
 * publish gate.
 *
 * The defect: a workspace that switched on `agreementRequired` or
 * `paymentRequired` got a client Hub correctly reporting "your report is held
 * back", and `GET /api/public/report/:tenant/:id` beside it serving the whole
 * report. Two readers of one condition, and the one that was wrong was the
 * enforcement point.
 *
 * Two things are asserted here and they are different claims:
 *   1. THE RULE — `resolveReleaseGate` decides correctly, against a real seeded
 *      database. This is the authority; `getReportGate` reads it too.
 *   2. THE WIRING — the endpoints ask, and refuse when the answer is a hold.
 *      Stubbed resolver on purpose: this half is about whether the endpoint
 *      consults the rule at all, which a real resolver would obscure.
 *
 * Every case has its opposite. A gate asserted only in the blocking direction
 * cannot tell a working gate from one that refuses everybody.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { OpenAPIHono } from '@hono/zod-openapi';
import { Hono } from 'hono';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import publicReportRoutes from '../../../server/api/public-report';
import { publicReportAccessAllowed } from '../../../server/lib/report-access';
import { runBuilderGate, runShareGate } from '../../../server/lib/repair-gates';
import { InspectionService } from '../../../server/services/inspection.service';
import type { HonoConfig } from '../../../server/types/hono';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';

const TENANT_ID = '00000000-0000-0000-0000-0000000000c1';
const INSP_ID = '00000000-0000-0000-0000-0000000000d1';
const AGR_REQ_ID = '00000000-0000-0000-0000-0000000000e1';
const AGR_ID = '00000000-0000-0000-0000-0000000000f1';
const SLUG = 'acme';

describe('publicReportAccessAllowed — the release gate is a second, independent gate', () => {
    const published = { renderMode: false, ownerPreview: false, reportStatus: 'published' } as const;

    it('serves a published report with nothing holding it back', () => {
        expect(publicReportAccessAllowed({ ...published, releaseGate: null })).toBe(true);
    });

    it('refuses a published report that is held for an agreement or a payment', () => {
        expect(publicReportAccessAllowed({ ...published, releaseGate: 'agreement' })).toBe(false);
        expect(publicReportAccessAllowed({ ...published, releaseGate: 'payment' })).toBe(false);
    });

    it('still refuses an unpublished report even when nothing else holds it', () => {
        // CONTROL: the two gates are independent, so adding the second one must
        // not have turned the first into a no-op.
        expect(publicReportAccessAllowed({
            renderMode: false, ownerPreview: false, reportStatus: 'in_progress', releaseGate: null,
        })).toBe(false);
    });

    it('lets the renderer and the owner through a hold', () => {
        // The headless renderer is how a gated report gets BUILT, and the owner
        // is its author. Blocking either would mean the hold could never be
        // cleared, because there would be no report to hand over.
        expect(publicReportAccessAllowed({
            renderMode: true, ownerPreview: false, reportStatus: 'published', releaseGate: 'payment',
        })).toBe(true);
        expect(publicReportAccessAllowed({
            renderMode: false, ownerPreview: true, reportStatus: 'in_progress', releaseGate: 'agreement',
        })).toBe(true);
    });
});

describe('InspectionService.resolveReleaseGate — the rule', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: { close(): void };

    async function seed(over: Partial<typeof schema.inspections.$inferInsert> = {}) {
        await db.insert(schema.tenants).values({
            id: TENANT_ID, slug: SLUG, status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        } as never);
        await db.insert(schema.inspections).values({
            id: INSP_ID, tenantId: TENANT_ID, propertyAddress: '1 Main St', clientName: 'Jane',
            clientEmail: 'jane@test.com', date: '2026-06-01', status: 'completed',
            reportStatus: 'published', paymentStatus: 'unpaid', price: 50000,
            agreementRequired: false, paymentRequired: false, createdAt: new Date(),
            ...over,
        } as never);
    }

    async function signTheAgreement() {
        await db.insert(schema.agreements).values({
            id: AGR_ID, tenantId: TENANT_ID, name: 'Standard Agreement',
            content: 'text', version: 1, createdAt: new Date(),
        } as never);
        await db.insert(schema.agreementRequests).values({
            id: AGR_REQ_ID, tenantId: TENANT_ID, inspectionId: INSP_ID, agreementId: AGR_ID,
            clientEmail: 'jane@test.com', clientName: 'Jane',
            status: 'signed', createdAt: new Date(),
        } as never);
    }

    const gate = () => new InspectionService({} as D1Database).resolveReleaseGate(INSP_ID, TENANT_ID);

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db as BetterSQLite3Database<typeof schema>;
        sqlite = setup.sqlite as { close(): void };
        await setupSchema(sqlite as never);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    });
    afterEach(() => sqlite.close());

    it('holds nothing back when the workspace requires neither', async () => {
        await seed();
        expect(await gate()).toBeNull();
    });

    it('holds for an agreement that is required and unsigned', async () => {
        await seed({ agreementRequired: true });
        expect((await gate())?.reason).toBe('agreement');
    });

    it('releases once that agreement is signed', async () => {
        await seed({ agreementRequired: true });
        await signTheAgreement();
        expect(await gate()).toBeNull();
    });

    it('holds for a payment that is required and outstanding', async () => {
        await seed({ paymentRequired: true, paymentStatus: 'unpaid' });
        expect((await gate())?.reason).toBe('payment');
    });

    it('releases once that payment is paid', async () => {
        await seed({ paymentRequired: true, paymentStatus: 'paid' });
        expect(await gate()).toBeNull();
    });

    it('ignores an unpaid invoice the workspace never required payment for', async () => {
        // DISCRIMINATING: `payment_status` is 'unpaid' from the moment an
        // inspection is created, invoice or no invoice. Reading it without its
        // required flag would hold back almost every report in the product.
        await seed({ paymentRequired: false, paymentStatus: 'unpaid' });
        expect(await gate()).toBeNull();
    });

    it('reports the agreement first when both are outstanding, and says payment is too', async () => {
        await seed({ agreementRequired: true, paymentRequired: true, paymentStatus: 'unpaid' });
        const g = await gate();
        expect(g?.reason).toBe('agreement');
        expect(g?.paymentOutstanding).toBe(true);
    });

    it('a manual unlock releases both', async () => {
        await seed({
            agreementRequired: true, paymentRequired: true,
            paymentStatus: 'unpaid', unlockedAt: new Date(),
        });
        expect(await gate()).toBeNull();
    });

    it('an inspection that does not exist is not an open gate', async () => {
        // A lookup miss must not read as "released". The callers 404 first; this
        // pins that a future caller who does not cannot fall into a release.
        expect(await gate()).toBeNull();
    });
});

describe('GET /api/public/report/:tenant/:id — the endpoint asks', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: { close(): void };

    async function seedPublished() {
        await db.insert(schema.tenants).values({
            id: TENANT_ID, slug: SLUG, status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        } as never);
        await db.insert(schema.inspections).values({
            id: INSP_ID, tenantId: TENANT_ID, propertyAddress: '1 Main St', clientName: 'Jane',
            clientEmail: 'jane@test.com', date: '2026-06-01', status: 'completed',
            reportStatus: 'published', paymentStatus: 'unpaid', price: 50000,
            agreementRequired: false, paymentRequired: false, createdAt: new Date(),
        } as never);
    }

    function buildApp(releaseGate: 'payment' | 'agreement' | null) {
        const getReportData = vi.fn().mockResolvedValue({ inspectionId: INSP_ID });
        const resolveReleaseGate = vi.fn().mockResolvedValue(releaseGate ? { reason: releaseGate, paymentOutstanding: releaseGate === 'payment' } : null);
        const app = new OpenAPIHono<HonoConfig>();
        app.use('*', async (c, next) => {
            (c as unknown as { env: Record<string, unknown> }).env = { DB: {} };
            c.set('services', {
                portalAccess: {
                    resolveToken: vi.fn().mockResolvedValue({
                        inspectionId: INSP_ID, tenantId: TENANT_ID, role: 'client',
                        recipientEmail: 'a@b.com', revokedAt: null, expiresAt: null,
                    }),
                },
                inspection: {
                    getReportData,
                    resolveReleaseGate,
                    resolveAgentViewToken: vi.fn().mockResolvedValue(null),
                },
                reportVersion: { getLatestPublished: vi.fn().mockResolvedValue(null) },
            } as unknown as HonoConfig['Variables']['services']);
            await next();
        });
        app.route('/api/public', publicReportRoutes);
        return { app, getReportData, resolveReleaseGate };
    }

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db as BetterSQLite3Database<typeof schema>;
        sqlite = setup.sqlite as { close(): void };
        await setupSchema(sqlite as never);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
        await seedPublished();
    });
    afterEach(() => sqlite.close());

    it('refuses a published report that is held, and does not build it', async () => {
        const { app, getReportData } = buildApp('payment');
        const res = await app.request(`/api/public/report/${SLUG}/${INSP_ID}?token=tok`);
        expect(res.status).toBe(403);
        const body = await res.json() as { error: { code: string } };
        expect(body.error.code).toBe('REPORT_GATED');
        // DISCRIMINATING: a refusal that still assembles the report has leaked
        // the work, and would leak the content on the next careless change.
        expect(getReportData).not.toHaveBeenCalled();
    });

    it('serves the same published report when nothing holds it', async () => {
        // POSITIVE CONTROL. Without this, a gate that refuses everybody passes.
        const { app, getReportData } = buildApp(null);
        const res = await app.request(`/api/public/report/${SLUG}/${INSP_ID}?token=tok`);
        expect(res.status).toBe(200);
        expect(getReportData).toHaveBeenCalled();
    });

    it('asks the rule rather than re-deciding from the inspection row', async () => {
        // The seeded row has both flags OFF. If the endpoint reached for the
        // columns itself instead of calling the authority, this hold would not
        // be seen and the request would succeed.
        const { app, resolveReleaseGate } = buildApp('agreement');
        const res = await app.request(`/api/public/report/${SLUG}/${INSP_ID}?token=tok`);
        expect(resolveReleaseGate).toHaveBeenCalledWith(INSP_ID, TENANT_ID);
        expect(res.status).toBe(403);
    });
});

describe('the repair builder is a door onto the same report', () => {
    // What the builder serves IS report content: every defect in the
    // inspection. A hold that stops the report page and not this one has not
    // held anything back, it has only moved where the reader clicks.
    let sqlite: { close(): void };

    beforeEach(async () => {
        const setup = createTestDb();
        sqlite = setup.sqlite as { close(): void };
        await setupSchema(sqlite as never);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(setup.db);
        await (setup.db as BetterSQLite3Database<typeof schema>).insert(schema.tenants).values({
            id: TENANT_ID, slug: SLUG, status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        } as never);
        await (setup.db as BetterSQLite3Database<typeof schema>).insert(schema.tenantConfigs).values({
            tenantId: TENANT_ID, enableCustomerRepairExport: true, updatedAt: new Date(),
        } as never);
        await (setup.db as BetterSQLite3Database<typeof schema>).insert(schema.inspections).values({
            id: INSP_ID, tenantId: TENANT_ID, propertyAddress: '1 Main St', clientName: 'Jane',
            clientEmail: 'jane@test.com', date: '2026-06-01', status: 'completed',
            reportStatus: 'published', paymentStatus: 'unpaid', price: 50000,
            agreementRequired: false, paymentRequired: false, createdAt: new Date(),
        } as never);
    });
    afterEach(() => sqlite.close());

    async function builderAnswer(releaseGate: 'payment' | 'agreement' | null): Promise<string> {
        const app = new Hono<HonoConfig>();
        app.get('/gate', async (c) => {
            (c as unknown as { env: Record<string, unknown> }).env = { DB: {} };
            c.set('services', {
                inspection: {
                    resolveReleaseGate: async () => (releaseGate ? { reason: releaseGate, paymentOutstanding: false } : null),
                },
            } as unknown as HonoConfig['Variables']['services']);
            const refusal = await runBuilderGate(c, INSP_ID, TENANT_ID);
            if (!refusal) return c.json({ gate: 'PASSED' });
            return refusal;
        });
        const res = await app.request('/gate');
        const body = await res.json() as { gate?: string; error?: { code?: string } };
        return body.gate === 'PASSED' ? 'PASSED' : (body.error?.code ?? `HTTP_${res.status}`);
    }

    it('refuses the builder while the report is held', async () => {
        expect(await builderAnswer('payment')).toBe('REPORT_GATED');
        expect(await builderAnswer('agreement')).toBe('REPORT_GATED');
    });

    it('opens the builder when nothing holds the report', async () => {
        // POSITIVE CONTROL: the feature is switched on for this workspace, so a
        // refusal here would mean the gate refuses everybody.
        expect(await builderAnswer(null)).toBe('PASSED');
    });
});

describe('the repair-request SHARE track is the fifth door', () => {
    // Missed by the first pass, and the easiest one to miss: its credential is a
    // share token minted when the list was built. A link created BEFORE a company
    // switched on "require payment" would otherwise keep working forever, and the
    // hold is per-inspection and can be switched on at any time — so a link that
    // was legitimate yesterday is no evidence that it is legitimate now.
    let sqlite: { close(): void };
    const SHARE_TOKEN = 'share-tok';

    beforeEach(async () => {
        const setup = createTestDb();
        sqlite = setup.sqlite as { close(): void };
        await setupSchema(sqlite as never);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(setup.db);
        const db = setup.db as BetterSQLite3Database<typeof schema>;
        await db.insert(schema.tenants).values({
            id: TENANT_ID, slug: SLUG, status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        } as never);
        await db.insert(schema.inspections).values({
            id: INSP_ID, tenantId: TENANT_ID, propertyAddress: '1 Main St', clientName: 'Jane',
            clientEmail: 'jane@test.com', date: '2026-06-01', status: 'completed',
            reportStatus: 'published', paymentStatus: 'unpaid', price: 50000,
            agreementRequired: false, paymentRequired: false, createdAt: new Date(),
        } as never);
    });
    afterEach(() => sqlite.close());

    async function shareAnswer(releaseGate: 'payment' | 'agreement' | null): Promise<string> {
        const app = new Hono<HonoConfig>();
        app.get('/share', async (c) => {
            (c as unknown as { env: Record<string, unknown> }).env = { DB: {} };
            c.set('services', {
                repairRequest: {
                    getByShareToken: async () => ({
                        request: { id: 'rr1', tenantId: TENANT_ID, inspectionId: INSP_ID, customIntro: null },
                        items: [],
                    }),
                },
                inspection: {
                    resolveReleaseGate: async () => (releaseGate ? { reason: releaseGate, paymentOutstanding: false } : null),
                },
            } as unknown as HonoConfig['Variables']['services']);
            const gate = await runShareGate(c, SHARE_TOKEN);
            if (gate instanceof Response) return gate;
            return c.json({ gate: 'PASSED' });
        });
        const res = await app.request('/share');
        const body = await res.json() as { gate?: string; error?: { code?: string } };
        return body.gate === 'PASSED' ? 'PASSED' : (body.error?.code ?? `HTTP_${res.status}`);
    }

    it('refuses a shared list while the report it came from is held', async () => {
        expect(await shareAnswer('payment')).toBe('REPORT_GATED');
        expect(await shareAnswer('agreement')).toBe('REPORT_GATED');
    });

    it('serves the shared list when nothing holds the report', async () => {
        // POSITIVE CONTROL: without this, a gate refusing everybody passes.
        expect(await shareAnswer(null)).toBe('PASSED');
    });
});
