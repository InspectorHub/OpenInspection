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
import { asD1Db } from '../helpers/test-db';
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
import { AppError, ErrorCode } from '../../../server/lib/errors';
import { COOLING_WINDOW_DEFER_REASON } from '../../../server/services/automation/cooling-window';

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
        id: TENANT, slug: 'acme-d2b0', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    } as never);
    await seedRoleProfiles(asD1Db(db), TENANT, new Date(1));
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

async function seedRule(opts: {
    recipientKind: 'role' | 'all';
    recipientRoleProfileId?: string | null;
    name?: string;
    emailTemplateId?: string | null;
}) {
    const ruleId = crypto.randomUUID();
    await db.insert(schema.automations).values({
        id: ruleId, tenantId: TENANT, name: opts.name ?? 'Report Ready', trigger: 'report.published',
        recipientKind: opts.recipientKind, recipientRoleProfileId: opts.recipientRoleProfileId ?? null,
        delayMinutes: 0, subjectTemplate: 'Subj', bodyTemplate: 'Body',
        emailTemplateId: opts.emailTemplateId ?? null,
        channels: JSON.stringify(['email']), active: true, isDefault: false, createdAt: new Date(),
    } as never);
    return ruleId;
}

async function seedTemplate(opts: { id: string; name: string; subject: string; body: string }) {
    await db.insert(schema.messageTemplates).values({
        id: opts.id, tenantId: TENANT, name: opts.name, channel: 'email',
        subject: opts.subject, body: opts.body,
        variables: JSON.stringify(['property_address', 'report_url']),
        isSeeded: true, locale: 'en', createdAt: new Date(), updatedAt: new Date(),
    } as never);
    return opts.id;
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
    const sendInspectionReportPdf = vi.fn(
        async (_to: string, _address: string, _linkUrl: string) => opts.pdfDelivered ?? true);
    const sendReportReady = vi.fn(
        async (_to: string, _address: string, _linkUrl: string) => opts.readyDelivered ?? true);
    // Parameters spelled out (not `async () => …`) so the call tuple is typed:
    // the rule-template assertions below read the subject, html, attachments and
    // classId positionally, and a zero-arg mock types every one of them as a
    // read past the end of an empty tuple.
    const sendEmail = vi.fn(async (
        _to: string[],
        _subject: string,
        _html: string,
        _attachments?: Array<{ filename: string; content: ArrayBuffer | string }>,
        _opts?: { classId?: string },
    ) => ({ delivered: true }));
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
        const links = sendInspectionReportPdf.mock.calls.map((c) => c[2]);
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

/**
 * The rule's `email_template_id` decides the copy, the same way it does on the
 * generic path. This branch used to ignore it and render the `report-ready`
 * catalogue default for every rule, so `report.published`'s five seeds — each
 * aimed at a different role — arrived as the same email under the same
 * required-class label.
 *
 * The shape these tests reproduce is a real one: a contact who is both the
 * client and the buyer's agent on one order sits under two role profiles, two
 * role-targeted rules fire, and both messages land in the same inbox. Nothing
 * de-duplicates them (per role is the intended fan-out) — so the ONLY thing
 * that makes them legible as two different messages is that they say two
 * different things.
 */
describe('AutomationService.flush — report.published uses the RULE\'s template, per role', () => {
    it('two role-targeted rules referencing different templates deliver two different subjects to the same inbox', async () => {
        const insp = 'insp-two-roles-one-inbox';
        await seedInspection(insp);
        const clientTpl = await seedTemplate({
            id: 'tpl-client', name: 'Report Ready — Email',
            subject: 'Your inspection report is ready — {{property_address}}',
            body: '<p>Your report for {{property_address}} is ready.</p>',
        });
        const agentTpl = await seedTemplate({
            id: 'tpl-agent', name: "Report Ready (Buyer's Agent) — Email",
            subject: 'Inspection report ready — {{property_address}}',
            body: '<p>The report for {{property_address}} is ready for your client.</p>',
        });
        const clientRule = await seedRule({
            recipientKind: 'role', recipientRoleProfileId: roleProfileId('client'),
            name: 'Report Ready', emailTemplateId: clientTpl,
        });
        const agentRule = await seedRule({
            recipientKind: 'role', recipientRoleProfileId: roleProfileId('buyer_agent'),
            name: "Report Ready (Buyer's Agent)", emailTemplateId: agentTpl,
        });
        // One person, both seats — the production case.
        await seedLog({ ruleId: clientRule, inspectionId: insp, recipient: 'pat@example.com', recipientRoleKey: 'client' });
        await seedLog({ ruleId: agentRule, inspectionId: insp, recipient: 'pat@example.com', recipientRoleKey: 'buyer_agent' });

        const { reportDelivery } = makeReportDelivery();
        const { emailFor, sendEmail, sendInspectionReportPdf } = makeEmailSvc();

        await svc.flush(emailFor, 'Acme', 'https://acme.example.com', undefined, 50, undefined, undefined, reportDelivery);

        // The catalogue default is no longer what goes out for a rule that names
        // its own template.
        expect(sendInspectionReportPdf).not.toHaveBeenCalled();
        expect(sendEmail).toHaveBeenCalledTimes(2);
        const subjects = sendEmail.mock.calls.map((c) => c[1]);
        expect(new Set(subjects).size).toBe(2);
        expect(subjects).toContain('Your inspection report is ready — 1 Main St');
        expect(subjects).toContain('Inspection report ready — 1 Main St');
    });

    it("interpolates {{report_url}} to the recipient's OWN tokenized link, and still attaches the PDF", async () => {
        const insp = 'insp-rule-tpl-link';
        await seedInspection(insp);
        const tpl = await seedTemplate({
            id: 'tpl-link', name: 'Report Ready — Email',
            subject: 'Ready — {{property_address}}',
            body: '<p><a href="{{report_url}}">View your report</a></p>',
        });
        const ruleId = await seedRule({
            recipientKind: 'role', recipientRoleProfileId: roleProfileId('buyer_agent'),
            name: 'Report Ready', emailTemplateId: tpl,
        });
        await seedLog({ ruleId, inspectionId: insp, recipient: 'agent@example.com', recipientRoleKey: 'buyer_agent' });

        const { reportDelivery } = makeReportDelivery();
        const { emailFor, sendEmail } = makeEmailSvc();

        await svc.flush(emailFor, 'Acme', 'https://acme.example.com', undefined, 50, undefined, undefined, reportDelivery);

        const [, , html, attachments] = sendEmail.mock.calls[0];
        // The bare report URL 404s for a recipient with no login; the token is
        // the entire reason this delivery path exists, so the rule's own copy
        // must not have cost the recipient theirs.
        expect(html).toContain(encodeURIComponent('tok-agent@example.com-buyer_agent'));
        // "Choosing different WORDING must not change what is ENCLOSED" —
        // the same rule the manual send learned the hard way.
        expect(attachments).toHaveLength(1);
    });

    it('carries the Art. 13 report-view disclosure that tenant copy cannot reach (OI #271, condition 5)', async () => {
        const insp = 'insp-rule-tpl-disclosure';
        await seedInspection(insp);
        // A template whose body says nothing at all — the adversarial case for a
        // notice that is supposed to be unreachable from tenant copy.
        const tpl = await seedTemplate({
            id: 'tpl-empty', name: 'Report Ready — Email', subject: 'Ready', body: '',
        });
        const ruleId = await seedRule({
            recipientKind: 'role', recipientRoleProfileId: roleProfileId('client'),
            name: 'Report Ready', emailTemplateId: tpl,
        });
        await seedLog({ ruleId, inspectionId: insp, recipient: 'client@example.com', recipientRoleKey: 'client' });

        const { reportDelivery } = makeReportDelivery();
        const { emailFor, sendEmail } = makeEmailSvc();

        await svc.flush(emailFor, 'Acme', 'https://acme.example.com', undefined, 50, undefined, undefined, reportDelivery);

        const { REPORT_VIEW_DISCLOSURE } = await import('../../../server/lib/legal/report-view-disclosure');
        const html = sendEmail.mock.calls[0][2];
        expect(html).toContain(REPORT_VIEW_DISCLOSURE.fact);
        expect(html).toContain(REPORT_VIEW_DISCLOSURE.limit);
        expect(html).toContain(REPORT_VIEW_DISCLOSURE.exit);
        expect(html).toContain(`data-disclosure-version="${REPORT_VIEW_DISCLOSURE.version}"`);
    });

    it("labels the send with the rule's OWN notification class, so a mutable seed stays mutable", async () => {
        const insp = 'insp-rule-tpl-class';
        await seedInspection(insp);
        const tpl = await seedTemplate({
            id: 'tpl-followup', name: 'Post-inspection follow-up — Email',
            subject: 'Following up on your inspection — {{property_address}}',
            body: '<p>How did it go?</p>',
        });
        // Spec §5.3: report-ready is REQUIRED, this one is not. Under the old
        // branch both arrived stamped `report-ready`, which the preference gate
        // fails closed on — so the recipient's switch did nothing.
        const ruleId = await seedRule({
            recipientKind: 'role', recipientRoleProfileId: roleProfileId('client'),
            name: 'Post-inspection follow-up', emailTemplateId: tpl,
        });
        await seedLog({ ruleId, inspectionId: insp, recipient: 'client@example.com', recipientRoleKey: 'client' });

        const { reportDelivery } = makeReportDelivery();
        const { emailFor, sendEmail } = makeEmailSvc();

        await svc.flush(emailFor, 'Acme', 'https://acme.example.com', undefined, 50, undefined, undefined, reportDelivery);

        expect(sendEmail.mock.calls[0][4]).toEqual({ classId: 'post-inspection-followup' });
    });

    it('a cooling-window refusal re-schedules the row to the unlock instant and keeps it PENDING', async () => {
        // A company signs up and publishes their first report the same
        // afternoon — the ordinary first day. Under a terminal status that
        // report is never delivered and nothing retries it, because nothing in
        // the repository moves a log back to pending.
        const insp = 'insp-cooling';
        await seedInspection(insp);
        const ruleId = await seedRule({
            recipientKind: 'role', recipientRoleProfileId: roleProfileId('client'), name: 'Report Ready',
        });
        const logId = await seedLog({ ruleId, inspectionId: insp, recipient: 'client@example.com', recipientRoleKey: 'client' });

        const unlockAtMs = Date.now() + 3 * 60 * 60 * 1000;
        const { reportDelivery } = makeReportDelivery();
        const { emailFor, sendReportReady } = makeEmailSvc();
        const svcs = await emailFor(TENANT);
        const refuse = () => {
            throw new AppError(403, ErrorCode.OUTBOUND_COOLING_WINDOW, 'not yet', { unlockAtMs, windowHours: 24 });
        };
        (svcs as unknown as { sendInspectionReportPdf: () => never }).sendInspectionReportPdf = refuse;

        await expect(
            svc.flush(async () => svcs, 'Acme', 'https://acme.example.com', undefined, 50, undefined, undefined, reportDelivery),
        ).resolves.not.toThrow();

        // The text-only retry is NOT attempted: the gate runs before the
        // provider request is built, so dropping the attachment cannot help.
        expect(sendReportReady).not.toHaveBeenCalled();
        const row = await db.select().from(schema.automationLogs).where(eq(schema.automationLogs.id, logId)).get();
        expect(row?.status).toBe('pending');
        expect(row?.deliveredAt).toBeNull();
        expect(row?.error).toBe(COOLING_WINDOW_DEFER_REASON);
        expect((row?.sendAt as Date).getTime()).toBe(unlockAtMs);
    });

    it('a rule pointing at a DELETED template falls back to the catalogue copy rather than withholding the report', async () => {
        const insp = 'insp-rule-tpl-stale';
        await seedInspection(insp);
        const ruleId = await seedRule({
            recipientKind: 'role', recipientRoleProfileId: roleProfileId('client'),
            name: 'Report Ready', emailTemplateId: 'tpl-that-was-deleted',
        });
        const logId = await seedLog({ ruleId, inspectionId: insp, recipient: 'client@example.com', recipientRoleKey: 'client' });

        const { reportDelivery } = makeReportDelivery();
        const { emailFor, sendEmail, sendInspectionReportPdf } = makeEmailSvc();

        await svc.flush(emailFor, 'Acme', 'https://acme.example.com', undefined, 50, undefined, undefined, reportDelivery);

        expect(sendEmail).not.toHaveBeenCalled();
        expect(sendInspectionReportPdf).toHaveBeenCalledTimes(1);
        const row = await db.select().from(schema.automationLogs).where(eq(schema.automationLogs.id, logId)).get();
        expect(row?.status).toBe('sent');
    });
});
