/**
 * Spec 2 Task 2b — AutomationService.flush() delivers `report.published`
 * EMAIL logs as a per-recipient tokenized portal link + the report PDF
 * (rendered once per inspection) when the new optional `reportDelivery` seam
 * is supplied. Mirrors the inline `completeInspection` send in
 * server/api/inspections/publish.ts, but per-recipient and cron-driven.
 *
 * The opt-in seam (server/services/automation/delivery.ts) means calling
 * flush() WITHOUT reportDelivery must leave every existing template-path test
 * (automation-reminders / automation-people-sourcing / automation-flush-sms /
 * automation-characterization / automation-delivery-characterization) green
 * and unchanged — this suite adds a dedicated opt-out case as a regression
 * guard for that seam, in addition to the new opt-in behavior.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { AutomationService } from '../../../server/services/automation.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import type { EmailService } from '../../../server/services/email.service';
import type { PortalAccessService } from '../../../server/services/portal-access.service';
import type { ReportPdfService } from '../../../server/services/report-pdf.service';
import type { ReportDeliveryDeps } from '../../../server/services/automation/report-email';

const TENANT = '00000000-0000-0000-0000-00000000d2b0';
const roleProfileId = (key: string) => `crp_${TENANT}_${key}`;

let db: BetterSQLite3Database<typeof schema>;
let svc: AutomationService;

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db;
    await setupSchema(fx.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    await db.insert(schema.tenants).values({
        id: TENANT, name: 'Acme', slug: 'acme-d2b0', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    } as never);
    await seedRoleProfiles(db, TENANT, new Date(1));
    svc = new AutomationService({} as D1Database);
    vi.spyOn(svc, 'ensureSeeds').mockResolvedValue();
});

async function seedInspection(id: string, over: Partial<typeof schema.inspections.$inferInsert> = {}) {
    await db.insert(schema.inspections).values({
        id, tenantId: TENANT, propertyAddress: '1 Main St',
        date: '2026-07-01', status: 'completed', reportStatus: 'published',
        paymentStatus: 'unpaid', price: 0, agreementRequired: false, paymentRequired: false,
        createdAt: new Date(), ...over,
    } as never);
}

async function seedRule(opts: { recipientKind: 'role' | 'all'; recipientRoleProfileId?: string | null }) {
    const ruleId = crypto.randomUUID();
    await db.insert(schema.automations).values({
        id: ruleId, tenantId: TENANT, name: 'Report Ready', trigger: 'report.published',
        recipientKind: opts.recipientKind, recipientRoleProfileId: opts.recipientRoleProfileId ?? null,
        delayMinutes: 0, subjectTemplate: 'Subj', bodyTemplate: 'Body',
        channels: JSON.stringify(['email']), active: true, isDefault: false, createdAt: new Date(),
    } as never);
    return ruleId;
}

async function seedLog(opts: { ruleId: string; inspectionId: string; recipient: string; recipientRoleKey?: string | null }) {
    const id = crypto.randomUUID();
    await db.insert(schema.automationLogs).values({
        id, tenantId: TENANT, automationId: opts.ruleId, inspectionId: opts.inspectionId,
        recipient: opts.recipient, recipientRoleKey: opts.recipientRoleKey ?? null,
        channel: 'email', sendAt: new Date(Date.now() - 1000), status: 'pending',
    } as never);
    return id;
}

/** Fake reportDelivery — the four deps are plain spies/objects (real types imported for casting only). */
function makeReportDelivery(opts: { pdfBytes?: ArrayBuffer | null } = {}) {
    const issueToken = vi.fn(async (input: { recipientEmail: string; role?: string }) => `tok-${input.recipientEmail}-${input.role}`);
    const getOrRender = vi.fn(async () => ({ id: 'rec-1', r2Key: 'k' }));
    const pdfBytes = opts.pdfBytes === undefined ? new ArrayBuffer(8) : opts.pdfBytes;
    const streamPdf = vi.fn(async () => {
        if (pdfBytes === null) return null;
        return { arrayBuffer: async () => pdfBytes } as unknown as R2ObjectBody;
    });
    const getContentHash = vi.fn(async () => 'hash-123');
    const reportDelivery: ReportDeliveryDeps = {
        portalAccess: { issueToken } as unknown as PortalAccessService,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        reportPdf: { getOrRender, streamPdf } as any as ReportPdfService,
        getContentHash,
        renderHost: 'app.example.com',
        renderSecret: 'render-secret',
    };
    return { reportDelivery, issueToken, getOrRender, streamPdf, getContentHash };
}

function makeEmailSvc(opts: { pdfDelivered?: boolean; readyDelivered?: boolean } = {}) {
    const sendInspectionReportPdf = vi.fn(async () => opts.pdfDelivered ?? true);
    const sendReportReady = vi.fn(async () => opts.readyDelivered ?? true);
    const sendEmail = vi.fn(async () => ({ delivered: true }));
    const emailFor = async (_tid: string) =>
        ({ sendInspectionReportPdf, sendReportReady, sendEmail } as unknown as EmailService);
    return { emailFor, sendInspectionReportPdf, sendReportReady, sendEmail };
}

describe('AutomationService.flush — report.published PDF-email delivery (Spec 2 Task 2b)', () => {
    it('role->buyer_agent recipient: issues a role-keyed token and sends the PDF email with a link carrying that token', async () => {
        const insp = 'insp-buyer-agent';
        await seedInspection(insp);
        const ruleId = await seedRule({ recipientKind: 'role', recipientRoleProfileId: roleProfileId('buyer_agent') });
        await seedLog({ ruleId, inspectionId: insp, recipient: 'agent@example.com', recipientRoleKey: 'buyer_agent' });

        const { reportDelivery, issueToken } = makeReportDelivery();
        const { emailFor, sendInspectionReportPdf, sendReportReady } = makeEmailSvc();

        await svc.flush(emailFor, 'Acme', 'https://acme.example.com', undefined, 50, undefined, undefined, reportDelivery);

        expect(issueToken).toHaveBeenCalledWith({
            tenantId: TENANT, inspectionId: insp, recipientEmail: 'agent@example.com', role: 'buyer_agent',
        });
        expect(sendInspectionReportPdf).toHaveBeenCalledTimes(1);
        expect(sendReportReady).not.toHaveBeenCalled();
        const [to, , linkUrl] = sendInspectionReportPdf.mock.calls[0];
        expect(to).toBe('agent@example.com');
        expect(linkUrl).toContain(encodeURIComponent('tok-agent@example.com-buyer_agent'));
    });

    it("recipientKind:'all' with 2 email recipients: renders the PDF exactly ONCE and sends 2 distinct tokenized links", async () => {
        const insp = 'insp-all-two';
        await seedInspection(insp);
        const ruleId = await seedRule({ recipientKind: 'all' });
        await seedLog({ ruleId, inspectionId: insp, recipient: 'client@example.com', recipientRoleKey: 'client' });
        await seedLog({ ruleId, inspectionId: insp, recipient: 'agent@example.com', recipientRoleKey: 'listing_agent' });

        const { reportDelivery, getOrRender } = makeReportDelivery();
        const { emailFor, sendInspectionReportPdf } = makeEmailSvc();

        await svc.flush(emailFor, 'Acme', 'https://acme.example.com', undefined, 50, undefined, undefined, reportDelivery);

        expect(getOrRender).toHaveBeenCalledTimes(1); // render-once memo, not once-per-recipient
        expect(sendInspectionReportPdf).toHaveBeenCalledTimes(2);
        const links = sendInspectionReportPdf.mock.calls.map((c) => c[2] as string);
        expect(new Set(links).size).toBe(2); // distinct tokens per recipient
    });

    it('PDF render failure (streamPdf returns null) falls back to the text-only sendReportReady, still tokenized, never throws', async () => {
        const insp = 'insp-pdf-fail';
        await seedInspection(insp);
        const ruleId = await seedRule({ recipientKind: 'role', recipientRoleProfileId: roleProfileId('client') });
        await seedLog({ ruleId, inspectionId: insp, recipient: 'client@example.com', recipientRoleKey: 'client' });

        const { reportDelivery } = makeReportDelivery({ pdfBytes: null });
        const { emailFor, sendInspectionReportPdf, sendReportReady } = makeEmailSvc();

        await expect(
            svc.flush(emailFor, 'Acme', 'https://acme.example.com', undefined, 50, undefined, undefined, reportDelivery),
        ).resolves.not.toThrow();

        expect(sendInspectionReportPdf).not.toHaveBeenCalled();
        expect(sendReportReady).toHaveBeenCalledTimes(1);
        const [, , linkUrl] = sendReportReady.mock.calls[0];
        expect(linkUrl).toContain(encodeURIComponent('tok-client@example.com-client'));
    });

    it('opt-out: calling flush WITHOUT reportDelivery leaves the existing generic template path in effect (no crash)', async () => {
        const insp = 'insp-optout';
        await seedInspection(insp);
        // ensureSeeds is mocked; backfill the template manually so the generic
        // path (which requires automation.emailTemplateId) has something to resolve.
        const ruleId = await seedRule({ recipientKind: 'role', recipientRoleProfileId: roleProfileId('client') });
        const { backfillAutomationTemplates } = await import('../../../server/services/message-template-backfill');
        await backfillAutomationTemplates({} as D1Database, TENANT);
        await seedLog({ ruleId, inspectionId: insp, recipient: 'client@example.com', recipientRoleKey: 'client' });

        const { emailFor, sendEmail, sendInspectionReportPdf, sendReportReady } = makeEmailSvc();

        await expect(
            svc.flush(emailFor, 'Acme', 'https://acme.example.com'), // no reportDelivery arg
        ).resolves.not.toThrow();

        expect(sendInspectionReportPdf).not.toHaveBeenCalled();
        expect(sendReportReady).not.toHaveBeenCalled();
        expect(sendEmail).toHaveBeenCalledTimes(1); // generic template path still fires
    });

    it('log status: after a successful report-PDF send, the automation_logs row is marked sent with deliveredAt set', async () => {
        const insp = 'insp-log-status';
        await seedInspection(insp);
        const ruleId = await seedRule({ recipientKind: 'role', recipientRoleProfileId: roleProfileId('client') });
        const logId = await seedLog({ ruleId, inspectionId: insp, recipient: 'client@example.com', recipientRoleKey: 'client' });

        const { reportDelivery } = makeReportDelivery();
        const { emailFor } = makeEmailSvc();

        await svc.flush(emailFor, 'Acme', 'https://acme.example.com', undefined, 50, undefined, undefined, reportDelivery);

        const row = await db.select().from(schema.automationLogs).where(eq(schema.automationLogs.id, logId)).get();
        expect(row?.status).toBe('sent');
        expect(row?.deliveredAt).not.toBeNull();
    });

    it('log status: when the report-ready template is disabled (or email not configured), sendInspectionReportPdf returns false and the row is marked skipped, not sent', async () => {
        const insp = 'insp-log-skipped';
        await seedInspection(insp);
        const ruleId = await seedRule({ recipientKind: 'role', recipientRoleProfileId: roleProfileId('client') });
        const logId = await seedLog({ ruleId, inspectionId: insp, recipient: 'client@example.com', recipientRoleKey: 'client' });

        const { reportDelivery } = makeReportDelivery();
        const { emailFor } = makeEmailSvc({ pdfDelivered: false });

        await expect(
            svc.flush(emailFor, 'Acme', 'https://acme.example.com', undefined, 50, undefined, undefined, reportDelivery),
        ).resolves.not.toThrow();

        const row = await db.select().from(schema.automationLogs).where(eq(schema.automationLogs.id, logId)).get();
        expect(row?.status).toBe('skipped');
        expect(row?.deliveredAt).toBeNull();
        expect(row?.error).toMatch(/not sent/);
    });

    it("log status: text-only fallback path (streamPdf returns null) also honors sendReportReady's false return as skipped", async () => {
        const insp = 'insp-log-skipped-textonly';
        await seedInspection(insp);
        const ruleId = await seedRule({ recipientKind: 'role', recipientRoleProfileId: roleProfileId('client') });
        const logId = await seedLog({ ruleId, inspectionId: insp, recipient: 'client@example.com', recipientRoleKey: 'client' });

        const { reportDelivery } = makeReportDelivery({ pdfBytes: null });
        const { emailFor } = makeEmailSvc({ readyDelivered: false });

        await expect(
            svc.flush(emailFor, 'Acme', 'https://acme.example.com', undefined, 50, undefined, undefined, reportDelivery),
        ).resolves.not.toThrow();

        const row = await db.select().from(schema.automationLogs).where(eq(schema.automationLogs.id, logId)).get();
        expect(row?.status).toBe('skipped');
        expect(row?.deliveredAt).toBeNull();
    });
});
