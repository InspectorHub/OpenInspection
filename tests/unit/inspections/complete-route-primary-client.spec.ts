/**
 * Task 9a (people-role-profiles) — POST /api/inspections/:id/complete must
 * resolve the auto-send recipient via PeopleService.getPrimaryClient instead
 * of reading the legacy inspection.clientEmail column, so the report-ready
 * email keeps going out after those columns are dropped (Task 13). This spec
 * seeds an inspection with the LEGACY client columns NULL and only
 * inspection_people populated, so it fails against the old implementation
 * (which reads only inspection.clientEmail and skips the send entirely).
 *
 * IA-30 Task 3 — /complete no longer fires the `report.published` automation
 * trigger at all. Once report publishing was decoupled from order completion
 * (Task 1/2), marking fieldwork complete could fire report delivery for a
 * report that was never published — clients would receive a link to an
 * unpublished report. `report.published` is a report event and now fires from
 * publish only; /complete is a pure order-lifecycle action. This spec asserts
 * the trigger is NOT called and no inline send happens.
 *
 * B3 — the route's own staff notification is gone too. It was raised directly,
 * outside the automation engine, and typed `report.published` even though the
 * route completes an inspection rather than publishing a report. The office
 * alert is now the seeded `Office alert — inspection completed` rule; the
 * positive assertion lives in tests/unit/automations/staff-alerts-via-rules.spec.ts,
 * and what this spec owes is proof the direct path is gone.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import { asD1Db } from '../helpers/test-db';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { OpenAPIHono } from '@hono/zod-openapi';
import { inspectionsRoutes } from '../../../server/api/inspections';
import { PeopleService } from '../../../server/services/people.service';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';

const TENANT = '00000000-0000-0000-0000-000000000001';
const CLIENT = 'contact-client-1';
const INSP_ID = '550e8400-e29b-41d4-a716-446655440000';
const SLUG = 'acme';

const roleProfileId = (key: string) => `crp_${TENANT}_${key}`;

let db: BetterSQLite3Database<typeof schema>;
let automationTrigger: ReturnType<typeof vi.fn>;
let issueToken: ReturnType<typeof vi.fn>;
let sendReportReady: ReturnType<typeof vi.fn>;
let sendInspectionReportPdf: ReturnType<typeof vi.fn>;
let createForAllAdmins: ReturnType<typeof vi.fn>;
let getInspection: ReturnType<typeof vi.fn>;

/** Tracks every promise scheduled via waitUntil so the test can await the
 * fire-and-forget notification effect after the response returns. */
function makeExecCtx() {
    const pending: Promise<unknown>[] = [];
    const ctx = {
        waitUntil: (p: Promise<unknown>) => { pending.push(Promise.resolve(p).catch(() => {})); },
        passThroughOnException: () => {},
    } as unknown as ExecutionContext;
    return { ctx, settle: () => Promise.all(pending) };
}

function buildApp(inspectionStub: { status: string; clientEmail: string | null; clientName: string | null; propertyAddress: string; inspectorId: string | null; id: string }) {
    const app = new OpenAPIHono<HonoConfig>();
    automationTrigger = vi.fn().mockResolvedValue(undefined);
    issueToken = vi.fn().mockResolvedValue('token-abc');
    sendReportReady = vi.fn().mockResolvedValue(undefined);
    sendInspectionReportPdf = vi.fn().mockResolvedValue(undefined);
    createForAllAdmins = vi.fn().mockResolvedValue(undefined);
    getInspection = vi.fn().mockResolvedValue({ inspection: inspectionStub });

    app.use('*', async (c, next) => {
        c.set('userRole', 'manager' as never);
        c.set('tenantId', TENANT);
        c.set('user', { sub: 'user-1' } as never);
        c.set('requestedTenantSlug', SLUG as never);
        c.set('services', {
            inspection: {
                getInspection,
                getReportContentHash: vi.fn().mockResolvedValue('hash-1'),
            },
            people: new PeopleService({ DB: {} as D1Database }),
            portalAccess: { issueToken },
            // No inline send in the route anymore — these stay here only to
            // assert they are NOT invoked directly by /complete.
            email: { sendReportReady, sendInspectionReportPdf },
            notification: { createForAllAdmins },
            automation: { trigger: automationTrigger },
        } as never);
        await next();
    });
    app.route('/api/inspections', inspectionsRoutes);
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status as never);
        }
        throw err;
    });
    return app;
}

const ENV = { DB: {}, APP_BASE_URL: 'https://acme.example.com', JWT_SECRET: 'test-secret' } as never;

describe('POST /api/inspections/:id/complete — primary-client resolution (Task 9a) + no report delivery (IA-30 Task 3)', () => {
    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

        await db.insert(schema.tenants).values({
            id: TENANT, slug: SLUG, status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await seedRoleProfiles(asD1Db(db), TENANT, new Date(1));
        await db.insert(schema.contacts).values({
            id: CLIENT, tenantId: TENANT, type: 'client', name: 'Jane Client',
            email: 'jane@example.com', phone: '+15551234567', createdAt: new Date(),
        });

        // Legacy client columns are intentionally NULL — only inspection_people
        // carries the primary client for this inspection.
        await db.insert(schema.inspections).values({
            id: INSP_ID, tenantId: TENANT,
            propertyAddress: '1 Main St',
            date: '2026-06-01', status: 'confirmed', paymentStatus: 'unpaid', price: 50000,
            agreementRequired: false, paymentRequired: false, createdAt: new Date(),
        });

        const people = new PeopleService({ DB: {} as D1Database });
        await people.addPerson(TENANT, INSP_ID, CLIENT, roleProfileId('client'));
    });

    function post() {
        const req = new Request(`https://acme.example.com/api/inspections/${INSP_ID}/complete`, { method: 'POST' });
        return req;
    }

    it('does not fire report.published (delivery is publish\'s job) but still records the admin notification with the resolved primary-client email', async () => {
        const { ctx, settle } = makeExecCtx();
        const app = buildApp({
            status: 'in_progress', clientEmail: null, clientName: null,
            propertyAddress: '1 Main St', inspectorId: null, id: INSP_ID,
        });
        const res = await app.fetch(post(), ENV, ctx);
        expect(res.status).toBe(200);
        await settle();

        // report.published belongs to publish. Marking fieldwork complete must
        // not deliver a report — it may not even be published yet.
        expect(automationTrigger).not.toHaveBeenCalled();
        expect(issueToken).not.toHaveBeenCalled();
        expect(sendInspectionReportPdf).not.toHaveBeenCalled();
        expect(sendReportReady).not.toHaveBeenCalled();

        // B3 — the route no longer writes a staff notification itself. It used
        // to raise one TYPED `report.published` from the COMPLETE route, which
        // was a mislabel on top of being unconfigurable; the office alert is
        // now the seeded `Office alert — inspection completed` rule, fired via
        // the `inspection.completed` trigger. The positive assertion lives in
        // tests/unit/automations/staff-alerts-via-rules.spec.ts — this spec
        // owns the route's side effects, and what it owes is proof that the
        // direct path is gone.
        expect(createForAllAdmins).not.toHaveBeenCalled();
    });

    it('no primary client at all — still no delivery, and still no direct notification', async () => {
        // Remove the seeded inspection_people row so getPrimaryClient resolves null.
        const { eq } = await import('drizzle-orm');
        await db.delete(schema.inspectionPeople).where(eq(schema.inspectionPeople.inspectionId, INSP_ID));

        const { ctx, settle } = makeExecCtx();
        const app = buildApp({
            status: 'in_progress', clientEmail: null, clientName: null,
            propertyAddress: '1 Main St', inspectorId: null, id: INSP_ID,
        });
        const res = await app.fetch(post(), ENV, ctx);
        expect(res.status).toBe(200);
        await settle();

        expect(automationTrigger).not.toHaveBeenCalled();
        expect(issueToken).not.toHaveBeenCalled();
        expect(sendReportReady).not.toHaveBeenCalled();
        expect(sendInspectionReportPdf).not.toHaveBeenCalled();

        // Same as above: the direct notification is gone regardless of whether a
        // primary client resolves. The primary-client lookup that fed its
        // metadata went with it — nothing else on this route read it.
        expect(createForAllAdmins).not.toHaveBeenCalled();
    });

    it('already-completed inspection short-circuits — no notification', async () => {
        const { ctx, settle } = makeExecCtx();
        const app = buildApp({
            status: 'completed', clientEmail: null, clientName: null,
            propertyAddress: '1 Main St', inspectorId: null, id: INSP_ID,
        });
        const res = await app.fetch(post(), ENV, ctx);
        expect(res.status).toBe(200);
        await settle();

        expect(automationTrigger).not.toHaveBeenCalled();
        expect(createForAllAdmins).not.toHaveBeenCalled();
    });
});
