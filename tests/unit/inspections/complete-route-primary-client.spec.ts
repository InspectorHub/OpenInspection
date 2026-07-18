/**
 * Task 9a (people-role-profiles) — POST /api/inspections/:id/complete must
 * resolve the auto-send recipient via PeopleService.getPrimaryClient instead
 * of reading the legacy inspection.clientEmail column, so the report-ready
 * email keeps going out after those columns are dropped (Task 13). This spec
 * seeds an inspection with the LEGACY client columns NULL and only
 * inspection_people populated, so it fails against the old implementation
 * (which reads only inspection.clientEmail and skips the send entirely).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
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
let sendReportReady: ReturnType<typeof vi.fn>;
let sendInspectionReportPdf: ReturnType<typeof vi.fn>;
let issueToken: ReturnType<typeof vi.fn>;
let createForAllAdmins: ReturnType<typeof vi.fn>;
let getInspection: ReturnType<typeof vi.fn>;

/** Tracks every promise scheduled via waitUntil so the test can await the
 * fire-and-forget delivery + notification effects after the response returns. */
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
    sendReportReady = vi.fn().mockResolvedValue(undefined);
    sendInspectionReportPdf = vi.fn().mockResolvedValue(undefined);
    issueToken = vi.fn().mockResolvedValue('token-abc');
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
            // reportPdf intentionally absent — deliver()'s try/catch falls back
            // to the text-only sendReportReady email, mirroring production's
            // "BROWSER binding missing" degrade path.
            email: { sendReportReady, sendInspectionReportPdf },
            notification: { createForAllAdmins },
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

describe('POST /api/inspections/:id/complete — primary-client resolution (Task 9a)', () => {
    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

        await db.insert(schema.tenants).values({
            id: TENANT, name: 'Acme', slug: SLUG, status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await seedRoleProfiles(db, TENANT, new Date(1));
        await db.insert(schema.contacts).values({
            id: CLIENT, tenantId: TENANT, type: 'client', name: 'Jane Client',
            email: 'jane@example.com', phone: '+15551234567', createdAt: new Date(),
        });

        // Legacy client columns are intentionally NULL — only inspection_people
        // carries the primary client for this inspection.
        await db.insert(schema.inspections).values({
            id: INSP_ID, tenantId: TENANT,
            propertyAddress: '1 Main St', clientName: null, clientEmail: null, clientPhone: null,
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

    it('sends the report-ready email to the primary client resolved via PeopleService, not inspection.clientEmail', async () => {
        const { ctx, settle } = makeExecCtx();
        const app = buildApp({
            status: 'in_progress', clientEmail: null, clientName: null,
            propertyAddress: '1 Main St', inspectorId: null, id: INSP_ID,
        });
        const res = await app.fetch(post(), ENV, ctx);
        expect(res.status).toBe(200);
        await settle();

        // issueToken must resolve the recipient email from the primary-client
        // join, not the (null) legacy column.
        expect(issueToken).toHaveBeenCalledTimes(1);
        expect(issueToken.mock.calls[0][0]).toMatchObject({ recipientEmail: 'jane@example.com', role: 'client' });

        // PDF render is unavailable in this harness (no reportPdf service) so
        // delivery falls back to the text-only email — still addressed to the
        // resolved primary client.
        expect(sendReportReady).toHaveBeenCalledTimes(1);
        expect(sendReportReady.mock.calls[0][0]).toBe('jane@example.com');

        // The in-app admin notification's metadata also carries the resolved email.
        expect(createForAllAdmins).toHaveBeenCalledTimes(1);
        expect(createForAllAdmins.mock.calls[0][1]).toMatchObject({ metadata: { clientEmail: 'jane@example.com' } });
    });

    it('no primary client at all — skips the auto-send (same as the legacy no-clientEmail behavior)', async () => {
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

        expect(issueToken).not.toHaveBeenCalled();
        expect(sendReportReady).not.toHaveBeenCalled();
        expect(sendInspectionReportPdf).not.toHaveBeenCalled();
        // The in-app notification still fires (unconditional in production), but its
        // clientEmail metadata is null now that there is no primary client.
        expect(createForAllAdmins).toHaveBeenCalledTimes(1);
        expect(createForAllAdmins.mock.calls[0][1]).toMatchObject({ metadata: { clientEmail: null } });
    });
});
