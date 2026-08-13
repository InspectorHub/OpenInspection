/**
 * Communication A2.2 — a MANUAL report send writes into the same
 * automation_logs ledger the automations use, with `automation_id IS NULL` as
 * the manual marker. Without this, the Outbox answers "what did the platform
 * send" while the operator's own sends — the ones a client calls about —
 * remain invisible.
 *
 * Harness copied from tests/unit/inspections/send-report-multi.spec.ts.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import { asD1Db } from '../helpers/test-db';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq, isNull, and } from 'drizzle-orm';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { OpenAPIHono } from '@hono/zod-openapi';
import { inspectionsRoutes } from '../../../server/api/inspections';
import { PeopleService } from '../../../server/services/people.service';
import { AppError, Errors } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';

const TENANT = '00000000-0000-0000-0000-0000000000b1';
const CLIENT = 'ct-msl-client';
const NO_EMAIL = 'ct-msl-noemail';
const INSP_ID = '550e8400-e29b-41d4-a716-4466554400b1';
const SLUG = 'acme-msl';

const roleProfileId = (key: string) => `crp_${TENANT}_${key}`;

let db: BetterSQLite3Database<typeof schema>;

function buildApp() {
    const app = new OpenAPIHono<HonoConfig>();
    const issueToken = vi.fn().mockImplementation(async ({ role }: { role: string }) => {
        if (role === 'bogus') throw Errors.BadRequest('Unknown role for tenant: ' + role);
        return 'token-1';
    });
    const fakePdfObj = { arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)) };
    app.use('*', async (c, next) => {
        c.set('userRole', 'manager' as never);
        c.set('tenantId', TENANT);
        c.set('user', { sub: 'user-1' } as never);
        c.set('requestedTenantSlug', SLUG as never);
        c.set('services', {
            inspection: {
                getInspection: vi.fn().mockResolvedValue({ inspection: { propertyAddress: '1 Main St', inspectorId: null, id: INSP_ID } }),
                getReportContentHash: vi.fn().mockResolvedValue('hash-1'),
            },
            people: new PeopleService({ DB: {} as D1Database }),
            portalAccess: { issueToken },
            reportPdf: { getOrRender: vi.fn().mockResolvedValue({ key: 'r' }), streamPdf: vi.fn().mockResolvedValue(fakePdfObj) },
            email: { sendReportReady: vi.fn().mockResolvedValue(true), sendInspectionReportPdf: vi.fn().mockResolvedValue(true) },
            automation: undefined,
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
const CTX = { waitUntil: () => {}, passThroughOnException: () => {} } as never;

function post(body: unknown) {
    return new Request(`https://acme.example.com/api/inspections/${INSP_ID}/send-report-pdf`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
}

async function manualRows() {
    return db.select().from(schema.automationLogs)
        .where(and(eq(schema.automationLogs.inspectionId, INSP_ID), isNull(schema.automationLogs.automationId)));
}

describe('manual send logging (A2.2)', () => {
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
        await db.insert(schema.contacts).values([
            { id: CLIENT, tenantId: TENANT, type: 'client', name: 'Jane', email: 'jane@x.com', phone: null, createdAt: new Date() },
            { id: NO_EMAIL, tenantId: TENANT, type: 'client', name: 'No Email', email: null, phone: null, createdAt: new Date() },
        ]);
    });

    it('writes one ledger row per recipient with automation_id NULL and a SHARED sendAt', async () => {
        const res = await buildApp().fetch(post({
            recipients: [
                { contactId: CLIENT, roleKey: 'client' },
                { email: 'oneoff@example.com', roleKey: 'attorney' },
            ],
        }), ENV, CTX);
        expect(res.status).toBe(200);

        const rows = await manualRows();
        expect(rows).toHaveLength(2);
        expect(rows.every(r => r.status === 'sent')).toBe(true);
        expect(rows.every(r => r.channel === 'email')).toBe(true);
        // One batch = one sendAt, so the Outbox collapses it into one notice.
        const sendAts = new Set(rows.map(r => (r.sendAt instanceof Date ? r.sendAt.getTime() : Number(r.sendAt))));
        expect(sendAts.size).toBe(1);
        const clientRow = rows.find(r => r.recipient === 'jane@x.com');
        expect(clientRow?.recipientContactId).toBe(CLIENT);
        expect(clientRow?.recipientRoleKey).toBe('client');
    });

    it('logs a skipped recipient with the same reason the response reports', async () => {
        const res = await buildApp().fetch(post({
            recipients: [{ contactId: NO_EMAIL, roleKey: 'client' }],
        }), ENV, CTX);
        expect(res.status).toBe(200);
        const body = (await res.json()) as { data: { skipped?: Array<{ reason: string }> } };
        expect(body.data.skipped).toHaveLength(1);

        const rows = await manualRows();
        expect(rows).toHaveLength(1);
        expect(rows[0].status).toBe('skipped');
        expect(rows[0].error).toBe(body.data.skipped![0].reason);
        expect(rows[0].recipientContactId).toBe(NO_EMAIL);
    });

    it('getCommunicationDeliveries marks the rows source:manual with automationId null', async () => {
        await buildApp().fetch(post({
            recipients: [{ contactId: CLIENT, roleKey: 'client' }],
        }), ENV, CTX);

        const { AutomationService } = await import('../../../server/services/automation.service');
        const deliveries = await new AutomationService({ DB: {} as D1Database } as never)
            .getCommunicationDeliveries(TENANT, INSP_ID);
        expect(deliveries).toHaveLength(1);
        expect(deliveries[0].source).toBe('manual');
        expect(deliveries[0].automationId).toBeNull();
        expect(deliveries[0].status).toBe('sent');
    });
});
