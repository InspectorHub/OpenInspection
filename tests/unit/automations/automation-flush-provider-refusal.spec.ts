/**
 * flush() when the email provider refuses a send, and the per-second throttle.
 *
 * A rate limit and a daily quota leave the row PENDING with send_at pushed (the
 * message is still owed and nothing moves a terminal row back to pending); a
 * monthly quota fails the row with a readable reason; anything else keeps its
 * old terminal behaviour. The throttle is injected so no test waits.
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
import { AppError, ErrorCode, Errors } from '../../../server/lib/errors';
import {
    RATE_LIMIT_DEFER_REASON, DAILY_QUOTA_DEFER_REASON, MONTHLY_QUOTA_FAIL_REASON, nextUtcMidnightMs,
} from '../../../server/services/automation/provider-deferral';
import type { EmailService } from '../../../server/services/email.service';
import type { SendThrottle } from '../../../server/services/automation/send-throttle';

const T = '00000000-0000-0000-0000-0000000000c4';
let db: BetterSQLite3Database<typeof schema>;
let svc: AutomationService;

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db;
    await setupSchema(fx.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    await db.insert(schema.tenants).values({
        id: T, slug: 'acme-c4', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    } as never);
    await seedRoleProfiles(asD1Db(db), T, new Date(1));
    await db.insert(schema.inspections).values({
        id: 'insp-1', tenantId: T, propertyAddress: '1 Main St', date: '2026-06-01', status: 'completed',
        reportStatus: 'published', paymentStatus: 'unpaid', price: 0, agreementRequired: false,
        paymentRequired: false, createdAt: new Date(),
    } as never);
    svc = new AutomationService({} as D1Database);
    await svc.ensureSeeds(T);
});

async function seedEmailLogs(ids: string[]) {
    const rule = (await db.select().from(schema.automations).where(eq(schema.automations.tenantId, T)))
        .find(a => a.name === 'Report Ready')!;
    for (const id of ids) {
        await db.insert(schema.automationLogs).values({
            id, tenantId: T, automationId: rule.id, inspectionId: 'insp-1',
            recipient: `${id}@example.com`, channel: 'email', sendAt: new Date(0), status: 'pending',
        } as never);
    }
}
const rowOf = (id: string) => db.select().from(schema.automationLogs).where(eq(schema.automationLogs.id, id)).get();
const emailThrowing = (err: unknown) => async () =>
    ({ sendEmail: async () => { throw err; } } as unknown as EmailService);
const quotaError = (quotaWindow?: 'daily' | 'monthly') => new AppError(402, ErrorCode.QUOTA_EXHAUSTED, 'quota',
    { metric: 'email', used: 0, cap: 0, billingPortalUrl: null, ...(quotaWindow ? { quotaWindow } : {}) });
const instantThrottle: SendThrottle = { beforeSend: async () => undefined };

async function flushWith(emailFor: () => Promise<EmailService>, throttle: SendThrottle = instantThrottle) {
    await svc.flush(emailFor, 'Acme', 'https://app.example.com', undefined, 50, undefined, undefined, undefined, { throttle });
}

describe('flush() — provider refusals', () => {
    it('keeps a rate-limited row PENDING and pushes send_at by retry-after', async () => {
        await seedEmailLogs(['log-rl']);
        const before = Date.now();
        await flushWith(emailThrowing(Errors.EmailRateLimited(30)));
        const row = await rowOf('log-rl');
        expect(row?.status).toBe('pending');
        expect(row?.error).toBe(RATE_LIMIT_DEFER_REASON);
        const sendAt = new Date(row!.sendAt as unknown as number | Date).getTime();
        expect(sendAt).toBeGreaterThanOrEqual(before + 30_000);
        expect(sendAt).toBeLessThan(Date.now() + 31_000);
    });

    it('keeps a daily-quota row PENDING until the next UTC midnight', async () => {
        await seedEmailLogs(['log-dq']);
        await flushWith(emailThrowing(quotaError('daily')));
        const row = await rowOf('log-dq');
        expect(row?.status).toBe('pending');
        expect(row?.error).toBe(DAILY_QUOTA_DEFER_REASON);
        expect(new Date(row!.sendAt as unknown as number | Date).getTime()).toBe(nextUtcMidnightMs(Date.now()));
    });

    it('does not pick a deferred row up again in the same tick', async () => {
        await seedEmailLogs(['log-dq']);
        const send = vi.fn(async () => { throw quotaError('daily'); });
        const emailFor = async () => ({ sendEmail: send } as unknown as EmailService);
        await flushWith(emailFor);
        await flushWith(emailFor);
        expect(send).toHaveBeenCalledTimes(1);
    });

    it('fails a monthly-quota row with a readable reason', async () => {
        await seedEmailLogs(['log-mq']);
        await flushWith(emailThrowing(quotaError('monthly')));
        const row = await rowOf('log-mq');
        expect(row?.status).toBe('failed');
        expect(row?.error).toBe(MONTHLY_QUOTA_FAIL_REASON);
    });

    it('keeps the old terminal failure for a quota whose window is unknown', async () => {
        await seedEmailLogs(['log-uq']);
        await flushWith(emailThrowing(quotaError()));
        expect((await rowOf('log-uq'))?.status).toBe('failed');
    });

    it('keeps the old terminal failure for an ordinary delivery error', async () => {
        await seedEmailLogs(['log-502']);
        await flushWith(emailThrowing(new AppError(502, ErrorCode.SERVICE_UNAVAILABLE, 'Email delivery failed. Please try again.')));
        const row = await rowOf('log-502');
        expect(row?.status).toBe('failed');
        expect(row?.error).toBe('Email delivery failed. Please try again.');
    });
});

describe('flush() — send throttle', () => {
    it('waits on the throttle before every email send, one call per send', async () => {
        await seedEmailLogs(['log-a', 'log-b', 'log-c']);
        const order: string[] = [];
        const throttle = { beforeSend: async () => { order.push('throttle'); } };
        const emailFor = async () => ({
            sendEmail: async () => { order.push('send'); return { delivered: true }; },
        } as unknown as EmailService);
        await flushWith(emailFor, throttle);
        expect(order).toEqual(['throttle', 'send', 'throttle', 'send', 'throttle', 'send']);
    });

    it('defaults to a real throttle so existing callers are throttled without opting in', async () => {
        await seedEmailLogs(['log-a']);
        const emailFor = async () => ({ sendEmail: async () => ({ delivered: true }) } as unknown as EmailService);
        await svc.flush(emailFor, 'Acme', 'https://app.example.com');
        expect((await rowOf('log-a'))?.status).toBe('sent');
    });
});
