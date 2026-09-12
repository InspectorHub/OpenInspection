/**
 * `{{company_name}}` on the MANUAL report send.
 *
 * The role-template branch of `POST /api/inspections/:id/send-report-pdf`
 * interpolated the tenant SLUG into `company_name`. A slug is a URL
 * identifier — lowercase, hyphenated, and frequently an abbreviation of the
 * real name — so a client whose inspector trades as "Northgate Home
 * Inspections" received an email signed "— seed-a". The recipient is outside
 * the tenant and has no way to tell that is the same company.
 *
 * The name belongs to `tenant_configs.company_name`, read through the one
 * resolver every other `{{company_name}}` interpolation uses
 * (`resolveAutomationCompanyName`), so a single email can never carry two
 * different company names.
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
import { makeExecutionContext } from '../helpers/exec-ctx';

const TENANT = '00000000-0000-0000-0000-000000000001';
const AGENT = 'contact-agent-1';
const INSP_ID = '550e8400-e29b-41d4-a716-446655440000';
// Deliberately slug-shaped and nothing like a trading name: the whole defect is
// that these two strings were used interchangeably.
const SLUG = 'seed-a';
const DISPLAY_NAME = 'Northgate Home Inspections';
const TPL_EMAIL = 'tpl-email-1';

let db: BetterSQLite3Database<typeof schema>;
let sendEmail: ReturnType<typeof vi.fn>;

function buildApp() {
    const app = new OpenAPIHono<HonoConfig>();
    sendEmail = vi.fn().mockResolvedValue({ delivered: true });

    app.use('*', async (c, next) => {
        c.set('userRole', 'manager' as never);
        c.set('tenantId', TENANT);
        c.set('user', { sub: 'user-1' } as never);
        c.set('requestedTenantSlug', SLUG as never);
        c.set('services', {
            inspection: {
                getInspection: vi.fn().mockResolvedValue({
                    inspection: {
                        id: INSP_ID, propertyAddress: '12 Oak St', inspectorId: null,
                        clientName: 'Jane Client', date: '2026-05-29',
                    },
                }),
                getReportContentHash: vi.fn().mockResolvedValue('hash-1'),
            },
            people: new PeopleService({ DB: {} as D1Database }),
            portalAccess: { issueToken: vi.fn().mockResolvedValue('tok-1') },
            reportPdf: {
                getOrRender: vi.fn().mockResolvedValue(null),
                streamPdf: vi.fn().mockResolvedValue(null),
            },
            email: {
                sendEmail,
                sendReportReady: vi.fn().mockResolvedValue(true),
                sendInspectionReportPdf: vi.fn().mockResolvedValue(true),
            },
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

const ENV = { DB: {}, APP_BASE_URL: 'https://reports.example.com', JWT_SECRET: 'test-secret' } as never;
const CTX = makeExecutionContext().ctx;

function post(recipients: unknown) {
    return new Request(`https://reports.example.com/api/inspections/${INSP_ID}/send-report-pdf`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ recipients }),
    });
}

const roleProfileId = (key: string) => `crp_${TENANT}_${key}`;

async function setRoleTemplate(key: string, templateId: string | null) {
    const { eq } = await import('drizzle-orm');
    await db.update(schema.contactRoleProfiles)
        .set({ emailTemplateId: templateId })
        .where(eq(schema.contactRoleProfiles.id, roleProfileId(key)));
}

describe('manual send-report — {{company_name}} is the display name, not the slug', () => {
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
            { id: AGENT, tenantId: TENANT, type: 'agent', name: 'Bob Agent', email: 'bob@brokerage.example.com', createdAt: new Date() },
        ]);
        await db.insert(schema.messageTemplates).values([
            {
                id: TPL_EMAIL, tenantId: TENANT, name: 'Agent report', channel: 'email',
                // The subject carries company_name and NOTHING else that could
                // contain the slug — the report URL in the body legitimately
                // does, so only the subject can discriminate.
                subject: 'Report from {{company_name}}',
                body: 'Hi — {{property_address}}. Read it: {{report_url}} — {{company_name}}',
                isSeeded: false, createdAt: new Date(), updatedAt: new Date(),
            },
        ]);
        await setRoleTemplate('buyer_agent', TPL_EMAIL);
    });

    it('interpolates the configured company name', async () => {
        await db.insert(schema.tenantConfigs).values({
            tenantId: TENANT, companyName: DISPLAY_NAME, updatedAt: new Date(),
        } as typeof schema.tenantConfigs.$inferInsert);

        const res = await buildApp().fetch(post([{ contactId: AGENT, roleKey: 'buyer_agent' }]), ENV, CTX);
        expect(res.status).toBe(200);
        expect(sendEmail).toHaveBeenCalledTimes(1);

        const [, subject, body] = sendEmail.mock.calls[0];
        expect(subject).toBe(`Report from ${DISPLAY_NAME}`);
        expect(body).toContain(`— ${DISPLAY_NAME}`);
        // The discriminating half: the slug must never stand in for the name.
        // The body keeps it (the report link is slug-addressed), so this is
        // asserted on the subject, which has no URL in it.
        expect(subject).not.toContain(SLUG);
    });

    it('renders company_name blank rather than the slug when no name is configured', async () => {
        // Same contract as every other {{company_name}} reader: '' reads as a
        // template gap, while a slug reads as a confident, wrong company.
        await db.insert(schema.tenantConfigs).values({
            tenantId: TENANT, companyName: null, updatedAt: new Date(),
        } as typeof schema.tenantConfigs.$inferInsert);

        const res = await buildApp().fetch(post([{ contactId: AGENT, roleKey: 'buyer_agent' }]), ENV, CTX);
        expect(res.status).toBe(200);
        expect(sendEmail).toHaveBeenCalledTimes(1);

        const [, subject] = sendEmail.mock.calls[0];
        expect(subject).toBe('Report from ');
        expect(subject).not.toContain(SLUG);
    });

    it('renders company_name blank when the tenant has no config row at all', async () => {
        const res = await buildApp().fetch(post([{ contactId: AGENT, roleKey: 'buyer_agent' }]), ENV, CTX);
        expect(res.status).toBe(200);
        expect(sendEmail).toHaveBeenCalledTimes(1);

        const [, subject] = sendEmail.mock.calls[0];
        expect(subject).toBe('Report from ');
        expect(subject).not.toContain(SLUG);
    });
});
