/**
 * A suspended company (which includes one scheduled for deletion) must not send.
 *
 * The HTTP guard only refuses requests. The cron flush never passes through it, so a
 * delayed message queued before the suspension would still have gone out. These tests
 * pin the cron path: rows of a suspended company are held (still pending, untouched),
 * and resume when the company is active again. The active-company row in the same
 * batch is the positive control: without it a flush that did nothing at all would pass.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { AutomationService } from '../../../server/services/automation.service';
import type { EmailService } from '../../../server/services/email.service';

const ACTIVE = '00000000-0000-0000-0000-0000000d0001';
const SUSPENDED = '00000000-0000-0000-0000-0000000d0002';

let db: BetterSQLite3Database<typeof schema>;
let svc: AutomationService;

async function seedTenant(id: string, status: 'active' | 'suspended') {
    await db.insert(schema.tenants).values({
        id, slug: `t-${id.slice(-4)}`, status,
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    } as never);
    await db.insert(schema.inspections).values({
        id: `insp-${id.slice(-4)}`, tenantId: id, propertyAddress: '1 Main St',
        date: '2026-07-01', status: 'completed', reportStatus: 'published',
        paymentStatus: 'unpaid', price: 0, agreementRequired: false, paymentRequired: false,
        createdAt: new Date(),
    } as never);
    // in_app rows settle inside flush() with no transport, so no mail provider is needed.
    await db.insert(schema.automationLogs).values({
        id: `log-${id.slice(-4)}`, tenantId: id, automationId: null, inspectionId: `insp-${id.slice(-4)}`,
        recipient: 'x@example.com', channel: 'in_app', sendAt: new Date(Date.now() - 1000), status: 'pending',
    } as never);
}

const emailFor = async () => ({ sendEmail: vi.fn() } as unknown as EmailService);
const status = async (id: string) =>
    (await db.select().from(schema.automationLogs).where(eq(schema.automationLogs.id, `log-${id.slice(-4)}`)).get())?.status;

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db;
    await setupSchema(fx.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    svc = new AutomationService({} as D1Database);
    vi.spyOn(svc, 'ensureSeeds').mockResolvedValue();
    await seedTenant(ACTIVE, 'active');
    await seedTenant(SUSPENDED, 'suspended');
});

describe('flush() — suspended company', () => {
    it('delivers the active company and holds the suspended one untouched', async () => {
        await svc.flush(emailFor, 'Acme', 'https://acme.example.com');
        expect(await status(ACTIVE)).toBe('sent');
        expect(await status(SUSPENDED)).toBe('pending');
        const held = await db.select().from(schema.automationLogs)
            .where(eq(schema.automationLogs.tenantId, SUSPENDED)).get();
        expect(held?.attempts).toBe(0);
    });

    it('resumes the held row once the company is active again', async () => {
        await svc.flush(emailFor, 'Acme', 'https://acme.example.com');
        await db.update(schema.tenants).set({ status: 'active' }).where(eq(schema.tenants.id, SUSPENDED));
        await svc.flush(emailFor, 'Acme', 'https://acme.example.com');
        expect(await status(SUSPENDED)).toBe('sent');
    });
});
