/**
 * Track B1 — the `in_app` channel, and the join that was hiding rows.
 *
 * Two things this pins, both of which are wrong today:
 *
 * 1. **flush() must not lose a row whose automation is NULL.** The query
 *    `innerJoin(automations)` was written when every log came from a rule.
 *    Manual sends already write `automation_id IS NULL` — they get away with
 *    it only because they are inserted already-terminal, so flush never has
 *    to see them. The moment anything enqueues a PENDING automation-less row
 *    (in_app is the first, B3 makes it routine) the join drops it and it sits
 *    pending forever, invisible, with no error anywhere. A left join plus an
 *    explicit story for every `automation.*` dereference is the fix.
 *
 * 2. **Delivering in_app means settling the ledger, not sending anything.**
 *    The notice HEADER is written at trigger time (C1) and the recipient's
 *    inbox reveals it when `send_at` passes (§3.14), so there is no dispatch
 *    to perform. What flush owes an in_app row is the same thing it owes an
 *    email row: evaluate the conditions, then record the outcome — otherwise
 *    the Outbox reads "Sending" forever for a notice that has been sitting in
 *    the reader's bell for a week.
 *
 *    It must NOT consume quota or consult consent: there is no provider, no
 *    carrier, and no per-message cost. The TCPA gate exists for messages that
 *    leave the building; charging a plan quota for a row in our own database
 *    would be inventing a cost.
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

const T = '00000000-0000-0000-0000-0000000000f1';
const INSP = '00000000-0000-0000-0000-0000000000f2';
let db: BetterSQLite3Database<typeof schema>;

/** An email service that fails the test if anything tries to send. */
const noEmail = async (): Promise<EmailService> =>
    ({
        sendEmail: async () => {
            throw new Error('in_app delivery must not send email');
        },
    }) as unknown as EmailService;

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db;
    await setupSchema(fx.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

    await db.insert(schema.tenants).values({
        id: T, slug: 'acme-in-app', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    } as never);
    await db.insert(schema.inspections).values({
        id: INSP, tenantId: T, propertyAddress: '1 Main St', date: '2026-06-01',
        status: 'completed', reportStatus: 'published', paymentStatus: 'unpaid',
        createdAt: new Date(),
    } as never);
});

async function insertRule(id: string) {
    await db.insert(schema.automations).values({
        id, tenantId: T, name: 'In-app notice', trigger: 'report.published',
        recipientKind: 'all', recipientRoleProfileId: null, delayMinutes: 0,
        channels: '["in_app"]',
        active: true, isDefault: false, createdAt: new Date(),
    } as never);
    return id;
}

async function insertLog(over: Record<string, unknown>) {
    const id = `log-${Math.random().toString(36).slice(2)}`;
    await db.insert(schema.automationLogs).values({
        id, tenantId: T, automationId: null, inspectionId: INSP,
        recipient: 'jane@x.com', channel: 'in_app', sendAt: new Date(0),
        status: 'pending', ...over,
    } as never);
    return id;
}

const readLog = async (id: string) =>
    (await db.select().from(schema.automationLogs).where(eq(schema.automationLogs.id, id))).at(0)!;

describe('in_app channel (B1)', () => {
    it('settles a due in_app row to sent, without sending anything', async () => {
        const ruleId = await insertRule('auto-in-app-1');
        const logId = await insertLog({ automationId: ruleId });

        await new AutomationService({} as D1Database).flush(noEmail, 'Acme', 'https://app.example.com');

        const row = await readLog(logId);
        expect(row.status).toBe('sent');
        expect(row.deliveredAt).not.toBeNull();
    });

    it('processes a PENDING row whose automation is NULL — the join must not hide it', async () => {
        // The whole defect in one row: no rule behind it, due, and today it is
        // dropped by the inner join and left pending forever with no error.
        const logId = await insertLog({ automationId: null });

        await new AutomationService({} as D1Database).flush(noEmail, 'Acme', 'https://app.example.com');

        expect((await readLog(logId)).status).toBe('sent');
    });

    it('never consumes plan quota for an in_app row — there is no message leaving the building', async () => {
        const ruleId = await insertRule('auto-in-app-2');
        await insertLog({ automationId: ruleId });

        const quotaGuard = {
            consumeInspection: vi.fn(),
            consumeEmail: vi.fn(),
            consumeSms: vi.fn(),
        };
        await new AutomationService({} as D1Database).flush(
            noEmail, 'Acme', 'https://app.example.com', undefined, 50, undefined,
            quotaGuard as never,
        );

        expect(quotaGuard.consumeEmail).not.toHaveBeenCalled();
        expect(quotaGuard.consumeSms).not.toHaveBeenCalled();
    });

    it('still honours the rule conditions — an in-app notice is a notice, not an exemption', async () => {
        const ruleId = await insertRule('auto-in-app-3');
        // requirePaid against an unpaid inspection: the rule must skip.
        await db.update(schema.automations)
            .set({ conditions: JSON.stringify({ requirePaid: true }) })
            .where(eq(schema.automations.id, ruleId));
        const logId = await insertLog({ automationId: ruleId });

        await new AutomationService({} as D1Database).flush(noEmail, 'Acme', 'https://app.example.com');

        const row = await readLog(logId);
        expect(row.status).toBe('skipped');
    });

    // Characterization, not a wish: this documents a REAL hole so the next
    // path that wants event_id idempotency knows it must carry an
    // automation_id. SQLite treats NULLs in a unique index as distinct, so
    // `uq_automation_logs_event` stops deduping the moment the rule is absent.
    // See the index's own comment for why it is left that way.
    it('event_id does NOT dedupe a ruleless row — the unique index is NULL-blind', async () => {
        const shared = { eventId: 'auto:report.published:x', automationId: null, recipient: 'jane@x.com' };
        await insertLog(shared);
        await insertLog(shared);

        const rows = await db.select().from(schema.automationLogs);
        expect(rows).toHaveLength(2);

        // The same pair WITH a rule collides, which is the guarantee the index
        // actually provides and the reason ruleless rows must not lean on it.
        const ruleId = await insertRule('auto-dedupe');
        await insertLog({ ...shared, automationId: ruleId });
        await expect(insertLog({ ...shared, automationId: ruleId })).rejects.toThrow();
    });

    it('leaves a row that is not due yet alone', async () => {
        const ruleId = await insertRule('auto-in-app-4');
        const logId = await insertLog({ automationId: ruleId, sendAt: new Date(Date.now() + 3_600_000) });

        await new AutomationService({} as D1Database).flush(noEmail, 'Acme', 'https://app.example.com');

        expect((await readLog(logId)).status).toBe('pending');
    });
});
