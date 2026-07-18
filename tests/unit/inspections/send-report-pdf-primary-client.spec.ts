/**
 * Task 9a (people-role-profiles) — POST /api/inspections/:id/send-report-pdf
 * must fall back to the primary client resolved via
 * PeopleService.getPrimaryClient (instead of the legacy inspection.clientEmail
 * column) when no `toEmail` override is supplied. This spec seeds an
 * inspection with the LEGACY client columns NULL and only inspection_people
 * populated, so it fails against the old implementation (400 "no recipient").
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
let getInspection: ReturnType<typeof vi.fn>;

function buildApp(inspectionStub: { propertyAddress: string; inspectorId: string | null; id: string }) {
    const app = new OpenAPIHono<HonoConfig>();
    sendReportReady = vi.fn().mockResolvedValue(undefined);
    sendInspectionReportPdf = vi.fn().mockResolvedValue(undefined);
    issueToken = vi.fn().mockResolvedValue('token-abc');
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
            // reportPdf intentionally absent — the handler's try/catch falls
            // back to the text-only sendReportReady email.
            email: { sendReportReady, sendInspectionReportPdf },
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

function post(body: unknown = {}) {
    return new Request(`https://acme.example.com/api/inspections/${INSP_ID}/send-report-pdf`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
}

describe('POST /api/inspections/:id/send-report-pdf — primary-client fallback (Task 9a)', () => {
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
    });

    it('no toEmail override — falls back to the primary client resolved via PeopleService', async () => {
        const people = new PeopleService({ DB: {} as D1Database });
        await people.addPerson(TENANT, INSP_ID, CLIENT, roleProfileId('client'));

        const app = buildApp({ propertyAddress: '1 Main St', inspectorId: null, id: INSP_ID });
        const res = await app.fetch(post(), ENV, CTX);
        expect(res.status).toBe(200);
        const body = (await res.json()) as { data: { sentTo: string } };
        expect(body.data.sentTo).toBe('jane@example.com');

        expect(issueToken.mock.calls[0][0]).toMatchObject({ recipientEmail: 'jane@example.com' });
        expect(sendReportReady.mock.calls[0][0]).toBe('jane@example.com');
    });

    it('explicit toEmail always wins over the primary client', async () => {
        const people = new PeopleService({ DB: {} as D1Database });
        await people.addPerson(TENANT, INSP_ID, CLIENT, roleProfileId('client'));

        const app = buildApp({ propertyAddress: '1 Main St', inspectorId: null, id: INSP_ID });
        const res = await app.fetch(post({ toEmail: 'override@example.com' }), ENV, CTX);
        expect(res.status).toBe(200);
        const body = (await res.json()) as { data: { sentTo: string } };
        expect(body.data.sentTo).toBe('override@example.com');
    });

    it('no toEmail and no primary client — 400 with an updated error message (no "inspection.clientEmail" wording)', async () => {
        const app = buildApp({ propertyAddress: '1 Main St', inspectorId: null, id: INSP_ID });
        const res = await app.fetch(post(), ENV, CTX);
        expect(res.status).toBe(400);
        const body = (await res.json()) as { error: { message: string } };
        expect(body.error.message).not.toContain('inspection.clientEmail');
        expect(sendReportReady).not.toHaveBeenCalled();
        expect(sendInspectionReportPdf).not.toHaveBeenCalled();
    });
});
