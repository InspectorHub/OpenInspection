/**
 * Role-specific report email on the MANUAL send.
 *
 * `contact_role_profiles.email_template_id` was written by the Edit Role modal
 * and read by NOTHING — an operator could set "Email template: Welcome" on the
 * Client role, save successfully, and no send path would ever consult it. A
 * control that silently does nothing is worse than a missing one: it reads as
 * configured.
 *
 * It is wired to the manual send specifically, and not as a general mechanism,
 * because a template hanging off a role cannot express WHEN to send. Triggered
 * messaging already belongs to Automations, which models it properly
 * (recipientKind='role' + a trigger + a template). The one moment a role
 * template can honestly mean something is when an operator presses Send — the
 * path Automations does not cover, and where every recipient previously got
 * byte-identical copy regardless of role.
 *
 * Most of what follows is the fallbacks. A stale template reference must never
 * cost someone their report.
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
const AGENT = 'contact-agent-1';
const INSP_ID = '550e8400-e29b-41d4-a716-446655440000';
const SLUG = 'acme';
const TPL_EMAIL = 'tpl-email-1';
const TPL_SMS = 'tpl-sms-1';

let db: BetterSQLite3Database<typeof schema>;
let sendEmail: ReturnType<typeof vi.fn>;
let sendReportReady: ReturnType<typeof vi.fn>;
let sendInspectionReportPdf: ReturnType<typeof vi.fn>;

function buildApp(withPdf = false) {
    const app = new OpenAPIHono<HonoConfig>();
    sendEmail = vi.fn().mockResolvedValue({ delivered: true });
    sendReportReady = vi.fn().mockResolvedValue(true);
    sendInspectionReportPdf = vi.fn().mockResolvedValue(true);

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
            // Default: no PDF, exercising the text path. `withPdf` flips it to
            // the attachment path, which is where IA-110 lived.
            reportPdf: withPdf
                ? {
                      getOrRender: vi.fn().mockResolvedValue({ key: 'pdf-record' }),
                      streamPdf: vi.fn().mockResolvedValue({ arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)) }),
                  }
                : { getOrRender: vi.fn().mockResolvedValue(null), streamPdf: vi.fn().mockResolvedValue(null) },
            email: { sendEmail, sendReportReady, sendInspectionReportPdf },
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

function post(recipients: unknown) {
    return new Request(`https://acme.example.com/api/inspections/${INSP_ID}/send-report-pdf`, {
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

describe('manual send-report — role email template', () => {
    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

        await db.insert(schema.tenants).values({
            id: TENANT, name: 'Acme', slug: SLUG, status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await seedRoleProfiles(asD1Db(db), TENANT, new Date(1));
        await db.insert(schema.contacts).values([
            { id: CLIENT, tenantId: TENANT, type: 'client', name: 'Jane Client', email: 'jane@example.com', createdAt: new Date() },
            { id: AGENT, tenantId: TENANT, type: 'agent', name: 'Bob Agent', email: 'bob@brokerage.example.com', createdAt: new Date() },
        ]);
        await db.insert(schema.messageTemplates).values([
            {
                id: TPL_EMAIL, tenantId: TENANT, name: 'Agent report', channel: 'email',
                subject: 'Report for {{property_address}}',
                body: 'Hi — {{client_name}} at {{property_address}}. Read it: {{report_url}}',
                isSeeded: false, createdAt: new Date(), updatedAt: new Date(),
            },
            {
                id: TPL_SMS, tenantId: TENANT, name: 'An SMS one', channel: 'sms',
                subject: null, body: 'sms body', isSeeded: false, createdAt: new Date(), updatedAt: new Date(),
            },
        ]);
    });

    it('sends the role’s template, with variables filled, instead of the default', async () => {
        await setRoleTemplate('buyer_agent', TPL_EMAIL);
        const res = await buildApp().fetch(post([{ contactId: AGENT, roleKey: 'buyer_agent' }]), ENV, CTX);
        expect(res.status).toBe(200);

        expect(sendEmail).toHaveBeenCalledTimes(1);
        const [to, subject, body] = sendEmail.mock.calls[0];
        expect(to).toEqual(['bob@brokerage.example.com']);
        expect(subject).toBe('Report for 12 Oak St');
        expect(body).toContain('Jane Client');
        expect(body).toContain('12 Oak St');
        // The tokenised per-recipient link, not a bare report URL.
        expect(body).toContain('tok-1');

        // The default copy must NOT also go out — one report, one email.
        expect(sendReportReady).not.toHaveBeenCalled();
    });

    it('still attaches the PDF when the role has a template', async () => {
        // IA-110 — the first version of this branch called sendEmail with no
        // attachment, so naming a template silently downgraded that recipient
        // to a link-only email while everyone else got the PDF — after the
        // render cost had already been paid once for the whole batch.
        // Choosing different WORDING must not change what is ENCLOSED.
        await setRoleTemplate('buyer_agent', TPL_EMAIL);
        const res = await buildApp(true).fetch(post([{ contactId: AGENT, roleKey: 'buyer_agent' }]), ENV, CTX);
        expect(res.status).toBe(200);

        expect(sendEmail).toHaveBeenCalledTimes(1);
        const attachments = sendEmail.mock.calls[0][3];
        expect(attachments).toHaveLength(1);
        expect(attachments[0].filename).toMatch(/\.pdf$/);
        expect(attachments[0].content).toBeTruthy();
    });

    it('leaves roles without a template on the default copy', async () => {
        const res = await buildApp().fetch(post([{ contactId: CLIENT, roleKey: 'client' }]), ENV, CTX);
        expect(res.status).toBe(200);
        expect(sendReportReady).toHaveBeenCalledTimes(1);
        expect(sendEmail).not.toHaveBeenCalled();
    });

    it('routes each recipient by their OWN role in one send', async () => {
        // The whole point: the agent and the client stop receiving identical mail.
        await setRoleTemplate('buyer_agent', TPL_EMAIL);
        const res = await buildApp().fetch(
            post([
                { contactId: AGENT, roleKey: 'buyer_agent' },
                { contactId: CLIENT, roleKey: 'client' },
            ]),
            ENV, CTX,
        );
        expect(res.status).toBe(200);
        expect(sendEmail).toHaveBeenCalledTimes(1);
        expect(sendEmail.mock.calls[0][0]).toEqual(['bob@brokerage.example.com']);
        expect(sendReportReady).toHaveBeenCalledTimes(1);
        expect(sendReportReady.mock.calls[0][0]).toBe('jane@example.com');
    });

    it('falls back when the referenced template was deleted', async () => {
        await setRoleTemplate('buyer_agent', 'tpl-that-no-longer-exists');
        const res = await buildApp().fetch(post([{ contactId: AGENT, roleKey: 'buyer_agent' }]), ENV, CTX);

        // A stale reference must not cost the recipient their report.
        expect(res.status).toBe(200);
        expect(sendReportReady).toHaveBeenCalledTimes(1);
        expect(sendEmail).not.toHaveBeenCalled();
    });

    it('falls back when the role points at an SMS template', async () => {
        // Nothing stops a bad UPDATE or an import naming the wrong channel.
        // Sending an SMS body as an email — with no subject — is worse than
        // the default wording.
        await setRoleTemplate('buyer_agent', TPL_SMS);
        const res = await buildApp().fetch(post([{ contactId: AGENT, roleKey: 'buyer_agent' }]), ENV, CTX);

        expect(res.status).toBe(200);
        expect(sendReportReady).toHaveBeenCalledTimes(1);
        expect(sendEmail).not.toHaveBeenCalled();
    });

    it('ignores a template on an INACTIVE role profile', async () => {
        const { eq } = await import('drizzle-orm');
        await setRoleTemplate('buyer_agent', TPL_EMAIL);
        await db.update(schema.contactRoleProfiles)
            .set({ active: false })
            .where(eq(schema.contactRoleProfiles.id, roleProfileId('buyer_agent')));

        const res = await buildApp().fetch(post([{ contactId: AGENT, roleKey: 'buyer_agent' }]), ENV, CTX);
        expect(res.status).toBe(200);
        expect(sendEmail).not.toHaveBeenCalled();
    });
});
