// {{company_name}} in a QUEUED automation message is the sending company's own
// brand name, on every send path. flush() used to be handed the deployment's app
// name by the cron and interpolated that, so a tenant's sign-off read
// "— OpenInspection" instead of their own company.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import { asD1Db } from '../helpers/test-db';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { AutomationService } from '../../../server/services/automation.service';
import { SmsConsentService } from '../../../server/services/sms-consent.service';
import { PeopleService } from '../../../server/services/people.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import * as brandModule from '../../../server/lib/sms/brand-name';
import * as companyNameModule from '../../../server/services/automation/company-name';
import type { EmailService } from '../../../server/services/email.service';
import type { PortalAccessService } from '../../../server/services/portal-access.service';
import type { ReportPdfService } from '../../../server/services/report-pdf.service';
import type { ReportDeliveryDeps } from '../../../server/services/automation/report-email';

const A = '00000000-0000-0000-0000-0000000000c1';
const B = '00000000-0000-0000-0000-0000000000c2';
const PLATFORM = 'PlatformAppName';
const roleProfileId = (key: string) => `crp_${A}_${key}`;
let db: BetterSQLite3Database<typeof schema>;
let svc: AutomationService;

async function setCompany(tenantId: string, companyName: string | null) {
    await db.insert(schema.tenantConfigs).values({ tenantId, companyName, updatedAt: new Date() } as never);
}

async function seedInspection(id = 'insp-1') {
    await db.insert(schema.inspections).values({
        id, tenantId: A, propertyAddress: '1 Main St', date: '2026-07-01', status: 'completed',
        reportStatus: 'published', paymentStatus: 'unpaid', price: 0,
        agreementRequired: false, paymentRequired: false, createdAt: new Date(),
    } as never);
    await db.insert(schema.contacts).values({
        id: 'c1', tenantId: A, type: 'client', name: 'Jane', email: 'jane@example.test', phone: '+15551234567', createdAt: new Date(),
    } as never);
    await new PeopleService({ DB: {} as D1Database }).addPerson(A, id, 'c1', roleProfileId('client'));
    return id;
}

async function seedRule(trigger: 'inspection.created' | 'report.published', channel: 'email' | 'sms', body: string) {
    const tplId = crypto.randomUUID();
    await db.insert(schema.messageTemplates).values({
        id: tplId, tenantId: A, name: 'T', channel, subject: channel === 'email' ? 'S' : null, body,
        variables: null, isSeeded: false, locale: 'en', createdAt: new Date(), updatedAt: new Date(),
    } as never);
    const ruleId = crypto.randomUUID();
    await db.insert(schema.automations).values({
        id: ruleId, tenantId: A, name: 'R', trigger, recipientKind: 'role', recipientRoleProfileId: roleProfileId('client'),
        delayMinutes: 0, channels: JSON.stringify([channel]), active: true, isDefault: false, createdAt: new Date(),
        ...(channel === 'email' ? { emailTemplateId: tplId } : { smsTemplateId: tplId }),
    } as never);
    return ruleId;
}

async function seedLog(ruleId: string, inspectionId: string, channel: 'email' | 'sms') {
    const id = crypto.randomUUID();
    await db.insert(schema.automationLogs).values({
        id, tenantId: A, automationId: ruleId, inspectionId, channel, recipientRoleKey: 'client',
        recipient: channel === 'email' ? 'jane@example.test' : '+15551234567',
        sendAt: new Date(Date.now() - 1000), status: 'pending',
    } as never);
    return id;
}

function emailHarness() {
    const sendEmail = vi.fn(async (_to: string[], _s: string, _h: string, _a?: unknown, _o?: unknown) => ({ delivered: true }));
    const emailFor = async () => ({ sendEmail, sendReportReady: vi.fn(), sendInspectionReportPdf: vi.fn() } as unknown as EmailService);
    return { sendEmail, emailFor };
}

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db;
    await setupSchema(fx.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    for (const [id, slug] of [[A, 'alpha'], [B, 'beta']] as const) {
        await db.insert(schema.tenants).values({
            id, slug, status: 'active', phone: '+15550001111', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        } as never);
    }
    await seedRoleProfiles(asD1Db(db), A, new Date(1));
    svc = new AutomationService({} as D1Database);
    vi.spyOn(svc, 'ensureSeeds').mockResolvedValue();
});

describe('{{company_name}} — generic queued email', () => {
    it('renders the tenant company name, not the deployment app name, and never another tenant\'s', async () => {
        await setCompany(A, 'Alpha Inspections');
        await setCompany(B, 'Beta Home Inspections');
        const insp = await seedInspection();
        const ruleId = await seedRule('inspection.created', 'email', '<p>From {{company_name}}</p>');
        const logId = await seedLog(ruleId, insp, 'email');
        const { sendEmail, emailFor } = emailHarness();
        await svc.flush(emailFor, PLATFORM, 'https://app.example.test');
        expect((await db.select().from(schema.automationLogs).where(eq(schema.automationLogs.id, logId)).get())?.status).toBe('sent');
        const html = sendEmail.mock.calls[0]![2];
        expect(html).toBe('<p>From Alpha Inspections</p>');
        expect(html).not.toContain(PLATFORM);
        expect(html).not.toContain('Beta');
    });

    it('renders blank, not the platform name, when the company has no name set', async () => {
        const insp = await seedInspection();
        const ruleId = await seedRule('inspection.created', 'email', '<p>From {{company_name}}</p>');
        await seedLog(ruleId, insp, 'email');
        const { sendEmail, emailFor } = emailHarness();
        await svc.flush(emailFor, PLATFORM, 'https://app.example.test');
        expect(sendEmail.mock.calls[0]![2]).toBe('<p>From </p>');
    });

    it('treats a whitespace-only company name as unset', async () => {
        await setCompany(A, '   ');
        const insp = await seedInspection();
        const ruleId = await seedRule('inspection.created', 'email', '<p>From {{company_name}}</p>');
        await seedLog(ruleId, insp, 'email');
        const { sendEmail, emailFor } = emailHarness();
        await svc.flush(emailFor, PLATFORM, 'https://app.example.test');
        expect(sendEmail.mock.calls[0]![2]).toBe('<p>From </p>');
    });
});

describe('{{company_name}} — lookup only when named', () => {
    it('email: no company-name read when the template omits the token, and it still renders when present', async () => {
        await setCompany(A, 'Alpha Inspections');
        const insp = await seedInspection();
        const spy = vi.spyOn(companyNameModule, 'resolveAutomationCompanyName');
        const without = await seedRule('inspection.created', 'email', '<p>Hello</p>');
        await seedLog(without, insp, 'email');
        const { emailFor } = emailHarness();
        await svc.flush(emailFor, PLATFORM, 'https://app.example.test');
        expect(spy).not.toHaveBeenCalled();
        const withTok = await seedRule('inspection.created', 'email', '<p>From {{company_name}}</p>');
        await seedLog(withTok, insp, 'email');
        const h = emailHarness();
        await svc.flush(h.emailFor, PLATFORM, 'https://app.example.test');
        expect(spy).toHaveBeenCalledTimes(1);
        expect(h.sendEmail.mock.calls[0]![2]).toBe('<p>From Alpha Inspections</p>');
    });
});

describe('{{company_name}} — queued SMS', () => {
    const fakeSend = vi.fn();
    const smsRuntime = {
        resolveProvider: vi.fn(async () => ({
            provider: { sendMessage: fakeSend, validateInboundSignature: vi.fn() }, from: '+1999',
        })),
    };
    beforeEach(async () => {
        fakeSend.mockReset().mockResolvedValue({ ok: true });
        await new SmsConsentService({} as D1Database).publishDisclosure('disclosure');
    });

    it('renders the tenant company name, not the deployment app name', async () => {
        await setCompany(A, 'Alpha Inspections');
        await setCompany(B, 'Beta Home Inspections');
        const insp = await seedInspection();
        const ruleId = await seedRule('inspection.created', 'sms', '{{company_name}}: see you soon');
        await seedLog(ruleId, insp, 'sms');
        await new SmsConsentService({} as D1Database).record(A, 'c1', 'granted', 'admin', {});
        await svc.flush(emailHarness().emailFor, PLATFORM, 'https://app.example.test', smsRuntime);
        expect(fakeSend).toHaveBeenCalledTimes(1);
        const sent = (fakeSend.mock.calls[0] as [{ body: string }])[0].body;
        expect(sent).toBe('Alpha Inspections: see you soon');
    });

    it('renders blank, not the platform name, when the company has no name set', async () => {
        const insp = await seedInspection();
        const ruleId = await seedRule('inspection.created', 'sms', '[{{company_name}}] see you soon');
        await seedLog(ruleId, insp, 'sms');
        await new SmsConsentService({} as D1Database).record(A, 'c1', 'granted', 'admin', {});
        await svc.flush(emailHarness().emailFor, PLATFORM, 'https://app.example.test', smsRuntime);
        const sent = (fakeSend.mock.calls[0] as [{ body: string }])[0].body;
        // A text must identify its sender: the slug stands in (brand-name.ts), never blank, never the platform.
        expect(sent).toBe('[alpha] see you soon');
        expect(sent).not.toContain(PLATFORM);
    });

    it('never shows another tenant name in the slug fallback either', async () => {
        await setCompany(B, 'Beta Home Inspections');
        const insp = await seedInspection();
        const ruleId = await seedRule('inspection.created', 'sms', '[{{company_name}}]');
        await seedLog(ruleId, insp, 'sms');
        await new SmsConsentService({} as D1Database).record(A, 'c1', 'granted', 'admin', {});
        await svc.flush(emailHarness().emailFor, PLATFORM, 'https://app.example.test', smsRuntime);
        expect((fakeSend.mock.calls[0] as [{ body: string }])[0].body).toBe('[alpha]');
    });

    it('reads no company name when the body does not name the token', async () => {
        await setCompany(A, 'Alpha Inspections');
        const insp = await seedInspection();
        const ruleId = await seedRule('inspection.created', 'sms', 'see you soon');
        await seedLog(ruleId, insp, 'sms');
        await new SmsConsentService({} as D1Database).record(A, 'c1', 'granted', 'admin', {});
        const spy = vi.spyOn(brandModule, 'resolveSmsBrand');
        await svc.flush(emailHarness().emailFor, PLATFORM, 'https://app.example.test', smsRuntime);
        expect(fakeSend).toHaveBeenCalledTimes(1);
        expect(spy).not.toHaveBeenCalled();
    });
});

describe('{{company_name}} — report-ready email path', () => {
    function reportDelivery(): ReportDeliveryDeps {
        return {
            portalAccess: { issueToken: vi.fn(async () => 'tok') } as unknown as PortalAccessService,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            reportPdf: {
                getOrRender: vi.fn(async () => ({ id: 'rec-1', r2Key: 'k' })),
                streamPdf: vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(8) } as unknown as R2ObjectBody)),
            } as any as ReportPdfService,
            resolvePdfTarget: vi.fn(async () => ({ versionNumber: null, contentHash: 'h' })),
            renderHost: 'app.example.test',
            renderSecret: 'render-secret',
        };
    }

    it('renders the tenant company name, not the deployment app name', async () => {
        await setCompany(A, 'Alpha Inspections');
        await setCompany(B, 'Beta Home Inspections');
        const insp = await seedInspection();
        const ruleId = await seedRule('report.published', 'email', '<p>From {{company_name}}</p>');
        await seedLog(ruleId, insp, 'email');
        const { sendEmail, emailFor } = emailHarness();
        await svc.flush(emailFor, PLATFORM, 'https://app.example.test', undefined, 50, undefined, undefined, reportDelivery());
        const html = sendEmail.mock.calls[0]![2];
        expect(html).toContain('From Alpha Inspections');
        expect(html).not.toContain(PLATFORM);
        expect(html).not.toContain('Beta');
    });

    it('renders blank when the company has no name set', async () => {
        const insp = await seedInspection();
        const ruleId = await seedRule('report.published', 'email', '<p>From {{company_name}}</p>');
        await seedLog(ruleId, insp, 'email');
        const { sendEmail, emailFor } = emailHarness();
        await svc.flush(emailFor, PLATFORM, 'https://app.example.test', undefined, 50, undefined, undefined, reportDelivery());
        const html = sendEmail.mock.calls[0]![2];
        expect(html).toContain('From </p>');
        expect(html).not.toContain(PLATFORM);
    });
});
