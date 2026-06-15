import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../server/lib/db/schema';
import { createTestDb, setupSchema } from './db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { AutomationService } from '../../server/services/automation.service';
import type { EmailService } from '../../server/services/email.service';

// Stub emailFor factory used by flush() tests. Returns delivered:true so the
// log status is set to 'sent' whenever conditions pass and email is configured.
const stubEmailFor = async (_tid: string) => ({ sendEmail: async () => ({ delivered: true }) } as unknown as EmailService);

const TENANT = '00000000-0000-0000-0000-000000000001';
let db: BetterSQLite3Database<typeof schema>;
let svc: AutomationService;

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db;
    await setupSchema(fx.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    await db.insert(schema.tenants).values({
        id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    svc = new AutomationService({} as D1Database);
});

describe('AutomationService create/update — conditions + channels (Track J/L)', () => {
    it('serializes conditions to JSON and defaults channels to email-only', async () => {
        const row = await svc.create(TENANT, {
            name: 'Follow-up', trigger: 'report.published', recipient: 'client',
            delayMinutes: 1440, subjectTemplate: 's', bodyTemplate: 'b',
            conditions: { requirePaid: true, serviceIds: ['svc-1'] },
        });
        // Track L (Part A) — channels parsed on output; conditions stays a JSON string.
        expect(row.channels).toEqual(['email']);
        expect(JSON.parse(row.conditions!)).toEqual({ requirePaid: true, serviceIds: ['svc-1'] });
    });

    it('update can clear conditions and change channels', async () => {
        const created = await svc.create(TENANT, {
            name: 'R', trigger: 'report.published', recipient: 'client',
            delayMinutes: 0, subjectTemplate: 's', bodyTemplate: 'b',
            conditions: { requireSigned: true },
        });
        const updated = await svc.update(TENANT, created.id, {
            conditions: null, channels: ['email', 'sms'], smsBody: 'hi',
        });
        expect(updated.conditions).toBeNull();
        expect(updated.channels).toEqual(['email', 'sms']);
    });
});

async function seedInspection(over: Partial<typeof schema.inspections.$inferInsert> = {}) {
    const id = over.id ?? crypto.randomUUID();
    await db.insert(schema.inspections).values({
        id, tenantId: TENANT, propertyAddress: '1 Main', clientName: 'Jane',
        clientEmail: 'jane@example.com', date: '2026-06-01', status: 'completed',
        reportStatus: 'published', paymentStatus: 'unpaid', price: 50000, agreementRequired: false,
        paymentRequired: false, createdAt: new Date(), ...over,
    } as never);
    return id;
}

async function seedRuleAndLog(opts: {
    conditions?: object | null; channel?: 'email' | 'sms'; body?: string; inspectionId: string;
}) {
    const ruleId = crypto.randomUUID();
    await db.insert(schema.automations).values({
        id: ruleId, tenantId: TENANT, name: 'R', trigger: 'report.published',
        recipient: 'client', delayMinutes: 0, subjectTemplate: 'Subj',
        bodyTemplate: opts.body ?? 'Body', active: true, isDefault: false,
        createdAt: new Date(),
        conditions: opts.conditions ? JSON.stringify(opts.conditions) : null,
        channel: opts.channel ?? 'email',
    } as never);
    const logId = crypto.randomUUID();
    await db.insert(schema.automationLogs).values({
        id: logId, tenantId: TENANT, automationId: ruleId, inspectionId: opts.inspectionId,
        recipient: 'jane@example.com', channel: opts.channel ?? 'email',
        sendAt: new Date(Date.now() - 1000).toISOString(),
        status: 'pending',
    } as never);
    return logId;
}

async function statusOf(logId: string) {
    const r = await db.select().from(schema.automationLogs)
        .where(eq(schema.automationLogs.id, logId)).get();
    return { status: r?.status, error: r?.error };
}

describe('AutomationService.flush — send-time gates (Track J)', () => {
    it('requirePaid skips an unpaid inspection', async () => {
        const insp = await seedInspection({ paymentStatus: 'unpaid' });
        const logId = await seedRuleAndLog({ conditions: { requirePaid: true }, inspectionId: insp });
        await svc.flush(stubEmailFor, 'Acme', 'https://acme.example.com');
        const s = await statusOf(logId);
        expect(s.status).toBe('skipped');
        expect(s.error).toMatch(/not paid/);
    });

    it('requirePaid sends when paid', async () => {
        const insp = await seedInspection({ paymentStatus: 'paid' });
        const logId = await seedRuleAndLog({ conditions: { requirePaid: true }, inspectionId: insp });
        await svc.flush(stubEmailFor, 'Acme', 'https://acme.example.com');
        expect((await statusOf(logId)).status).toBe('sent');
    });

    it('requireSigned skips when no signed agreement_request exists', async () => {
        const insp = await seedInspection();
        const logId = await seedRuleAndLog({ conditions: { requireSigned: true }, inspectionId: insp });
        await svc.flush(stubEmailFor, 'Acme', 'https://acme.example.com');
        const s = await statusOf(logId);
        expect(s.status).toBe('skipped');
        expect(s.error).toMatch(/not signed/);
    });

    it('serviceIds skips when the inspection booked none of them', async () => {
        const insp = await seedInspection();
        const logId = await seedRuleAndLog({ conditions: { serviceIds: ['svc-x'] }, inspectionId: insp });
        await svc.flush(stubEmailFor, 'Acme', 'https://acme.example.com');
        expect((await statusOf(logId)).status).toBe('skipped');
    });

    it('review_url body is skipped (fail-closed) until tenant_configs.review_url is set, then sends', async () => {
        const insp = await seedInspection();
        const logId = await seedRuleAndLog({ body: 'Leave us a review: {{review_url}}', inspectionId: insp });
        await svc.flush(stubEmailFor, 'Acme', 'https://acme.example.com');
        expect((await statusOf(logId)).status).toBe('skipped');

        await db.insert(schema.tenantConfigs).values({ tenantId: TENANT, reviewUrl: 'https://g.page/r/acme', updatedAt: new Date() } as never);
        const logId2 = await seedRuleAndLog({ body: 'Leave us a review: {{review_url}}', inspectionId: insp });
        await svc.flush(stubEmailFor, 'Acme', 'https://acme.example.com');
        expect((await statusOf(logId2)).status).toBe('sent');
    });
});
