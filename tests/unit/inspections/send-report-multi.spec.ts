/**
 * Spec 2 Task 6 — POST /api/inspections/:id/send-report-pdf, generalized to
 * an arbitrary set of role-keyed recipients (each contactId or one-off
 * email + roleKey). Supersedes the retired single-recipient "toEmail
 * defaults to primary client" contract (formerly covered by
 * send-report-pdf-primary-client.spec.ts) — this endpoint has no frontend
 * caller yet, so the request/response contract changed freely.
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
import { AppError, Errors } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';

const TENANT = '00000000-0000-0000-0000-000000000001';
const CLIENT = 'contact-client-1';
const BUYER_AGENT = 'contact-buyer-agent-1';
const NO_EMAIL_CONTACT = 'contact-no-email-1';
const INSP_ID = '550e8400-e29b-41d4-a716-446655440000';
const SLUG = 'acme';

const roleProfileId = (key: string) => `crp_${TENANT}_${key}`;

let db: BetterSQLite3Database<typeof schema>;
let sendReportReady: ReturnType<typeof vi.fn>;
let sendInspectionReportPdf: ReturnType<typeof vi.fn>;
let issueToken: ReturnType<typeof vi.fn>;
let getInspection: ReturnType<typeof vi.fn>;
let getOrRender: ReturnType<typeof vi.fn>;
let streamPdf: ReturnType<typeof vi.fn>;

function buildApp(inspectionStub: { propertyAddress: string; inspectorId: string | null; id: string }) {
    const app = new OpenAPIHono<HonoConfig>();
    sendReportReady = vi.fn().mockResolvedValue(true);
    sendInspectionReportPdf = vi.fn().mockResolvedValue(true);
    // Each call returns a distinct token so per-recipient link assertions
    // (distinct linkUrls) are meaningful — mirrors the real service's
    // per-(inspection, recipient) stable-token behavior.
    let tokenCounter = 0;
    issueToken = vi.fn().mockImplementation(async ({ role }: { role: string }) => {
        const knownRoles = new Set(['client', 'co_client', 'buyer_agent', 'listing_agent', 'attorney', 'transaction_coordinator', 'insurance_agent', 'title_company']);
        if (!knownRoles.has(role)) throw Errors.BadRequest('Unknown role for tenant: ' + role);
        tokenCounter += 1;
        return `token-${tokenCounter}`;
    });
    getInspection = vi.fn().mockResolvedValue({ inspection: inspectionStub });
    const fakePdfObj = { arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)) };
    getOrRender = vi.fn().mockResolvedValue({ key: 'pdf-record' });
    streamPdf = vi.fn().mockResolvedValue(fakePdfObj);

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
            reportPdf: { getOrRender, streamPdf },
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

function post(body: unknown) {
    return new Request(`https://acme.example.com/api/inspections/${INSP_ID}/send-report-pdf`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
}

describe('POST /api/inspections/:id/send-report-pdf — multi-recipient, role-keyed (Spec 2 Task 6)', () => {
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
        await db.insert(schema.contacts).values([
            { id: CLIENT, tenantId: TENANT, type: 'client', name: 'Jane Client', email: 'jane@example.com', phone: '+15551234567', createdAt: new Date() },
            { id: BUYER_AGENT, tenantId: TENANT, type: 'agent', name: 'Bob Agent', email: 'bob@brokerage.example.com', phone: '+15559876543', createdAt: new Date() },
            { id: NO_EMAIL_CONTACT, tenantId: TENANT, type: 'client', name: 'No Email Guy', email: null, phone: null, createdAt: new Date() },
        ]);
    });

    it('sends to two recipients (contactId + one-off email), renders the PDF once, mints per-recipient tokens, and audits each', async () => {
        const people = new PeopleService({ DB: {} as D1Database });
        await people.addPerson(TENANT, INSP_ID, BUYER_AGENT, roleProfileId('buyer_agent'));

        const app = buildApp({ propertyAddress: '1 Main St', inspectorId: null, id: INSP_ID });
        const res = await app.fetch(post({
            recipients: [
                { contactId: BUYER_AGENT, roleKey: 'buyer_agent' },
                { email: 'oneoff@example.com', roleKey: 'attorney' },
            ],
        }), ENV, CTX);

        expect(res.status).toBe(200);
        const body = (await res.json()) as { data: { sentTo: string[]; skipped?: unknown[] } };
        expect(body.data.sentTo.sort()).toEqual(['bob@brokerage.example.com', 'oneoff@example.com'].sort());
        expect(body.data.skipped).toBeUndefined();

        // Render-once: getOrRender/streamPdf invoked exactly once regardless
        // of two recipients.
        expect(getOrRender).toHaveBeenCalledTimes(1);
        expect(streamPdf).toHaveBeenCalledTimes(1);

        // issueToken called twice with the RIGHT role + recipientEmail per recipient.
        expect(issueToken).toHaveBeenCalledTimes(2);
        expect(issueToken.mock.calls[0][0]).toMatchObject({ recipientEmail: 'bob@brokerage.example.com', role: 'buyer_agent' });
        expect(issueToken.mock.calls[1][0]).toMatchObject({ recipientEmail: 'oneoff@example.com', role: 'attorney' });

        // sendInspectionReportPdf called twice with DISTINCT linkUrls (distinct tokens).
        expect(sendInspectionReportPdf).toHaveBeenCalledTimes(2);
        expect(sendReportReady).not.toHaveBeenCalled();
        const linkUrl1 = sendInspectionReportPdf.mock.calls[0][2] as string;
        const linkUrl2 = sendInspectionReportPdf.mock.calls[1][2] as string;
        expect(linkUrl1).not.toBe(linkUrl2);
    });

    it('a recipient whose contactId has no email is skipped; the other recipient still gets sent, no 500', async () => {
        const app = buildApp({ propertyAddress: '1 Main St', inspectorId: null, id: INSP_ID });
        const res = await app.fetch(post({
            recipients: [
                { contactId: NO_EMAIL_CONTACT, roleKey: 'client' },
                { contactId: CLIENT, roleKey: 'client' },
            ],
        }), ENV, CTX);

        expect(res.status).toBe(200);
        const body = (await res.json()) as { data: { sentTo: string[]; skipped?: Array<{ recipient: string; reason: string }> } };
        expect(body.data.sentTo).toEqual(['jane@example.com']);
        expect(body.data.skipped).toHaveLength(1);
        expect(body.data.skipped?.[0]).toMatchObject({ recipient: NO_EMAIL_CONTACT });
        expect(sendInspectionReportPdf).toHaveBeenCalledTimes(1);
    });

    it('an unknown roleKey fails gracefully for that recipient only — batch still 200', async () => {
        const app = buildApp({ propertyAddress: '1 Main St', inspectorId: null, id: INSP_ID });
        const res = await app.fetch(post({
            recipients: [
                { email: 'weird@example.com', roleKey: 'not_a_real_role' },
                { contactId: CLIENT, roleKey: 'client' },
            ],
        }), ENV, CTX);

        expect(res.status).toBe(200);
        const body = (await res.json()) as { data: { sentTo: string[]; skipped?: Array<{ recipient: string; reason: string }> } };
        expect(body.data.sentTo).toEqual(['jane@example.com']);
        expect(body.data.skipped).toHaveLength(1);
        expect(body.data.skipped?.[0].recipient).toBe('weird@example.com');
    });

    it('empty recipients array — 400 (Zod validation), no emails sent', async () => {
        const app = buildApp({ propertyAddress: '1 Main St', inspectorId: null, id: INSP_ID });
        const res = await app.fetch(post({ recipients: [] }), ENV, CTX);
        expect(res.status).toBe(400);
        expect(sendReportReady).not.toHaveBeenCalled();
        expect(sendInspectionReportPdf).not.toHaveBeenCalled();
    });
});
