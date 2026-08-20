/**
 * The four messages an assisted import sends, and why none of them is an
 * in-app notice.
 *
 * The person waiting on this may not sign in for weeks — that is the shape of
 * the problem: they uploaded an export because they are moving in, which is
 * exactly when they are not yet living in the product. A message that exists
 * only on a screen they have not opened is not a message.
 *
 * There is no fallback to another channel. If the email path is not working the
 * message is not sent and the failure is logged. Reaching for SMS here would
 * mean a person who gave us an email address gets a text about a file.
 *
 * Two reminders, not one. The first says there is still time to act; the second
 * says the file goes in seven days. A run the operator merely staged gets only
 * the second, because its whole window is as long as the first reminder's lead.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Database as SqliteDatabase } from 'better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import { asD1DrizzleReturn } from '../helpers/test-db';
import * as schema from '../../../server/lib/db/schema';
import type { EmailService } from '../../../server/services/email.service';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { MigrationAssistanceService } from '../../../server/services/migration-intake/assistance.service';
import type { EmailServiceEnv } from '../../../server/lib/email/build-email-service';
import {
    MIGRATION_INTAKE_FIRST_REMINDER_LEAD_DAYS,
    MIGRATION_INTAKE_REMINDER_LEAD_DAYS,
} from '../../../server/lib/compliance/retention-windows';

const TENANT = '11111111-1111-1111-1111-1111111111a1';
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-08-18T04:00:00.000Z');

type TestDb = BetterSQLite3Database<typeof schema>;
type Sent = { method: string; to: string[] };

/** An env that is structurally an `EmailServiceEnv` and reaches no provider. */
const ENV = { DB: {} as D1Database } as unknown as EmailServiceEnv;

/**
 * A stand-in for the tenant's email service with ONE method per outcome.
 *
 * Four separate spies rather than one with a mode argument, so a test can say
 * "the declined message went and the ready one did not" — which is the whole
 * reason the real surface has four methods too.
 */
function fakeEmail(sent: Sent[], failOn?: string) {
    const record = (method: string) => async (to: string[]) => {
        if (method === failOn) throw new Error('provider down');
        sent.push({ method, to });
    };
    return {
        sendMigrationImportReceived: vi.fn(record('received')),
        sendMigrationImportReady: vi.fn(record('ready')),
        sendMigrationImportDeclined: vi.fn(record('declined')),
        sendMigrationImportExpiring: vi.fn(record('expiring')),
    };
}

/** The fake is structurally a fraction of EmailService; the cast is that gap. */
const asEmail = (fake: ReturnType<typeof fakeEmail>) => fake as unknown as EmailService;

async function seed(
    db: TestDb,
    id: string,
    status: 'staged' | 'needs_assistance' | 'applied',
    expiresAt: Date,
) {
    await db.insert(schema.migrationBatches).values({
        id, tenantId: TENANT, createdBy: 'owner-1',
        intent: 'assisted.full',
        vendor: 'csv_generic', adapterName: 'none', adapterVersion: '0',
        manifest: '{"warnings":[]}',
        status,
        createdAt: new Date(NOW.getTime() - DAY),
        expiresAt,
        sourceKey: `${TENANT}/migrations/${id}/source.csv`,
    });
}

describe('MigrationAssistanceService — who gets told', () => {
    let db: TestDb;
    let sqlite: SqliteDatabase;
    let svc: MigrationAssistanceService;
    let sent: Sent[];

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        sqlite = fix.sqlite;
        await setupSchema(sqlite);
        vi.mocked(mockDrizzle).mockReturnValue(asD1DrizzleReturn(db));
        sent = [];
        await db.insert(schema.tenants).values({
            id: TENANT, slug: 'a', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await db.insert(schema.users).values([
            { id: 'owner-1', tenantId: TENANT, email: 'owner@example.test', passwordHash: 'x', role: 'owner', createdAt: new Date() },
            { id: 'mgr-1', tenantId: TENANT, email: 'mgr@example.test', passwordHash: 'x', role: 'manager', createdAt: new Date() },
            { id: 'insp-1', tenantId: TENANT, email: 'insp@example.test', passwordHash: 'x', role: 'inspector', createdAt: new Date() },
            { id: 'gone-1', tenantId: TENANT, email: 'gone@example.test', passwordHash: 'x', role: 'owner', createdAt: new Date(), deletedAt: new Date() },
        ]);
        svc = new MigrationAssistanceService(ENV);
    });

    afterEach(() => {
        sqlite.close();
        vi.clearAllMocks();
    });

    it('writes to the people who can act, and to nobody else', async () => {
        const email = fakeEmail(sent);
        expect(await svc.notifyDelivered(asEmail(email), TENANT, 'b-1')).toBe(2);
        expect(sent).toHaveLength(1);
        expect(sent[0]!.to.slice().sort()).toEqual(['mgr@example.test', 'owner@example.test']);
        // An inspector cannot open the imports screen, and a removed owner is
        // not a person here any more.
        expect(sent[0]!.to).not.toContain('insp@example.test');
        expect(sent[0]!.to).not.toContain('gone@example.test');
    });

    it('sends nothing, and says so, when there is nobody to write to', async () => {
        await db.delete(schema.users);
        const email = fakeEmail(sent);
        expect(await svc.notifyDelivered(asEmail(email), TENANT, 'b-1')).toBe(0);
        expect(email.sendMigrationImportReady).not.toHaveBeenCalled();
    });

    it('does not reach for another channel when the email path fails', async () => {
        const email = fakeEmail(sent, 'ready');
        expect(await svc.notifyDelivered(asEmail(email), TENANT, 'b-1')).toBe(0);
        // Nothing else was tried. There is no second path, on purpose.
        expect(email.sendMigrationImportDeclined).not.toHaveBeenCalled();
        expect(email.sendMigrationImportExpiring).not.toHaveBeenCalled();
    });

    it('has one method per outcome, so a declined run does not read as a delivered one', async () => {
        const email = fakeEmail(sent);
        await svc.notifyDeclined(asEmail(email), TENANT, 'b-1', 'The archive is password protected.');
        await svc.notifyReceived(asEmail(email), TENANT, 'b-1');
        expect(sent.map((s) => s.method)).toEqual(['declined', 'received']);
    });

    it('writes no in-app notice at all — the recipient is not signing in', async () => {
        // The positive control for that claim is the row count above: two
        // people WERE reached, by email, on the same pass that wrote nothing
        // to the notifications table.
        expect(await svc.notifyDelivered(asEmail(fakeEmail(sent)), TENANT, 'b-1')).toBe(2);
        expect(await db.select().from(schema.notifications).all()).toEqual([]);
    });
});

describe('MigrationAssistanceService.remindExpiring', () => {
    let db: TestDb;
    let sqlite: SqliteDatabase;
    let svc: MigrationAssistanceService;
    let sent: Sent[];
    let email: ReturnType<typeof fakeEmail>;

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        sqlite = fix.sqlite;
        await setupSchema(sqlite);
        vi.mocked(mockDrizzle).mockReturnValue(asD1DrizzleReturn(db));
        sent = [];
        email = fakeEmail(sent);
        await db.insert(schema.tenants).values({
            id: TENANT, slug: 'a', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await db.insert(schema.users).values({
            id: 'owner-1', tenantId: TENANT, email: 'owner@example.test', passwordHash: 'x', role: 'owner', createdAt: new Date(),
        });
        svc = new MigrationAssistanceService(ENV);
        svc.mailerFor = async () => asEmail(email);
    });

    afterEach(() => {
        sqlite.close();
        vi.clearAllMocks();
    });

    async function manifestOf(id: string): Promise<Record<string, unknown>> {
        const row = await db.select().from(schema.migrationBatches)
            .where(eq(schema.migrationBatches.id, id)).get();
        return JSON.parse(row?.manifest as string) as Record<string, unknown>;
    }

    it('prints all three numbers on a pass with nothing to do', async () => {
        // A pass that examined nothing and a pass that found nothing due must
        // not produce the same line, or a broken job reads as a quiet one.
        expect(await svc.remindExpiring(NOW)).toEqual({ scanned: 0, firstReminded: 0, finalReminded: 0 });
    });

    it('sends the first reminder to a waiting run a month from its date', async () => {
        await seed(db, 'b-wait', 'needs_assistance',
            new Date(NOW.getTime() + (MIGRATION_INTAKE_FIRST_REMINDER_LEAD_DAYS - 1) * DAY));
        expect(await svc.remindExpiring(NOW)).toEqual({ scanned: 1, firstReminded: 1, finalReminded: 0 });
        expect(sent).toHaveLength(1);
        expect(sent[0]!.method).toBe('expiring');
        expect(sent[0]!.to).toEqual(['owner@example.test']);
    });

    it('sends the final reminder a week out, even though the first already went', async () => {
        await seed(db, 'b-wait', 'needs_assistance',
            new Date(NOW.getTime() + (MIGRATION_INTAKE_FIRST_REMINDER_LEAD_DAYS - 1) * DAY));
        await svc.remindExpiring(NOW);
        const later = new Date(NOW.getTime()
            + (MIGRATION_INTAKE_FIRST_REMINDER_LEAD_DAYS - MIGRATION_INTAKE_REMINDER_LEAD_DAYS) * DAY);
        expect(await svc.remindExpiring(later)).toMatchObject({ scanned: 1, firstReminded: 0, finalReminded: 1 });
        expect(sent).toHaveLength(2);
    });

    it('never repeats either reminder, and still says it looked', async () => {
        await seed(db, 'b-wait', 'needs_assistance', new Date(NOW.getTime() + 2 * DAY));
        expect(await svc.remindExpiring(NOW)).toMatchObject({ scanned: 1, finalReminded: 1 });
        // `scanned: 1` is the load-bearing half of the second pass. A job that
        // had stopped seeing the run at all would also report zero sent, and
        // that is a broken job rather than a quiet one.
        expect(await svc.remindExpiring(new Date(NOW.getTime() + DAY)))
            .toEqual({ scanned: 1, firstReminded: 0, finalReminded: 0 });
        expect(sent).toHaveLength(1);
    });

    it('reminds again once the mark is cleared, so the mark is what silences it', async () => {
        // Positive control for the test above. Without it, "it stayed quiet"
        // could be caused by the window, the status or the mail path rather
        // than by the mark the design relies on.
        await seed(db, 'b-wait', 'needs_assistance', new Date(NOW.getTime() + 2 * DAY));
        await svc.remindExpiring(NOW);
        await db.update(schema.migrationBatches).set({ manifest: '{"warnings":[]}' })
            .where(eq(schema.migrationBatches.id, 'b-wait'));
        expect(await svc.remindExpiring(NOW)).toEqual({ scanned: 1, firstReminded: 0, finalReminded: 1 });
        expect(sent).toHaveLength(2);
    });

    it('gives a staged run only the final reminder, because its whole window is the first one lead', async () => {
        await seed(db, 'b-staged', 'staged',
            new Date(NOW.getTime() + (MIGRATION_INTAKE_FIRST_REMINDER_LEAD_DAYS - 1) * DAY));
        expect(await svc.remindExpiring(NOW)).toEqual({ scanned: 1, firstReminded: 0, finalReminded: 0 });

        await db.update(schema.migrationBatches)
            .set({ expiresAt: new Date(NOW.getTime() + 2 * DAY) })
            .where(eq(schema.migrationBatches.id, 'b-staged'));
        expect(await svc.remindExpiring(NOW)).toMatchObject({ scanned: 1, finalReminded: 1 });
    });

    it('says nothing about a run that has already gone past its date', async () => {
        await seed(db, 'b-gone', 'needs_assistance', new Date(NOW.getTime() - DAY));
        expect(await svc.remindExpiring(NOW)).toEqual({ scanned: 0, firstReminded: 0, finalReminded: 0 });
        expect(sent).toEqual([]);
    });

    it('says nothing about a run that has been applied', async () => {
        await seed(db, 'b-done', 'applied', new Date(NOW.getTime() + 2 * DAY));
        expect(await svc.remindExpiring(NOW)).toEqual({ scanned: 0, firstReminded: 0, finalReminded: 0 });
    });

    it('does not mark a reminder that nobody received', async () => {
        await db.delete(schema.users);
        await seed(db, 'b-wait', 'needs_assistance', new Date(NOW.getTime() + 2 * DAY));
        expect(await svc.remindExpiring(NOW)).toEqual({ scanned: 1, firstReminded: 0, finalReminded: 0 });
        // Marking a failed send would spend the reminder on nothing.
        expect((await manifestOf('b-wait')).intakeReminderFinalSentAt).toBeUndefined();
    });

    it('records each reminder separately on the run', async () => {
        await seed(db, 'b-wait', 'needs_assistance',
            new Date(NOW.getTime() + (MIGRATION_INTAKE_FIRST_REMINDER_LEAD_DAYS - 1) * DAY));
        await svc.remindExpiring(NOW);
        const manifest = await manifestOf('b-wait');
        expect(manifest.intakeReminderFirstSentAt).toBe(NOW.toISOString());
        // Two marks, not one: they answer different questions, and the second
        // still has to be able to fire.
        expect(manifest.intakeReminderFinalSentAt).toBeUndefined();
        // The rest of the manifest survives the mark — it is the record of what
        // the producing run read, and a reminder must not overwrite it.
        expect(manifest.warnings).toEqual([]);
    });
});
