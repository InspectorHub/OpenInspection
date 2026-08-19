/**
 * The clock on a run nobody has finished, and the one message it sends.
 *
 * "We have not delivered yet" is a reason to chase, not a reason to keep: what
 * is being kept is a third party's name, email address and phone number, in a
 * file we asked permission to store. So the run expires, and seven days before
 * it does the people who can act on it are told once.
 *
 * Once, and the once is enforced by a mark on the run rather than by hoping the
 * cron does not run twice. A daily job that re-sends every day is a job that
 * teaches people to ignore it.
 *
 * Every "it stayed quiet" case below is paired with the number of runs the pass
 * LOOKED at. Silence from a job that examined nothing and silence from a job
 * that found nothing due are the same silence, and only the first is a bug.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Database as SqliteDatabase } from 'better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { asD1DrizzleReturn } from '../helpers/test-db';
import type { MigrationBatchStatus } from '../../../server/lib/status/migration-batch-status';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import {
    MIGRATION_INTAKE_REMINDED_METADATA_KEY,
    MigrationAssistanceService,
    expiryFor,
} from '../../../server/services/migration-intake/assistance.service';
import {
    MIGRATION_INTAKE_ASSISTED_RETENTION_DAYS,
    MIGRATION_INTAKE_REMINDER_LEAD_DAYS,
    MIGRATION_INTAKE_STAGED_RETENTION_DAYS,
} from '../../../server/lib/compliance/retention-windows';

const TENANT = '11111111-1111-1111-1111-1111111111a1';
const OTHER_TENANT = '99999999-9999-9999-9999-9999999999f9';
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-08-18T04:00:00.000Z');

type TestDb = BetterSQLite3Database<typeof schema>;

async function seed(
    db: TestDb,
    id: string,
    expiresAt: Date | null,
    status: MigrationBatchStatus,
    over: { tenantId?: string; manifest?: string } = {},
) {
    const tenantId = over.tenantId ?? TENANT;
    await db.insert(schema.migrationBatches).values({
        id, tenantId, createdBy: 'u1',
        intent: 'assisted.full',
        vendor: 'csv_generic', adapterName: 'none', adapterVersion: '0',
        manifest: over.manifest ?? '{"warnings":[]}',
        status,
        createdAt: new Date(NOW.getTime() - DAY),
        expiresAt,
        sourceKey: `${tenantId}/migrations/${id}/source.csv`,
    });
}

async function seedTenant(db: TestDb, id: string, slug: string, ownerId: string) {
    await db.insert(schema.tenants).values({
        id, slug, status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await db.insert(schema.users).values({
        id: ownerId, tenantId: id, email: `${ownerId}@example.test`,
        passwordHash: 'x', role: 'owner', createdAt: new Date(),
    });
}

describe('expiryFor', () => {
    it('gives a run waiting on a person the longer window', () => {
        expect(expiryFor(true, NOW).getTime())
            .toBe(NOW.getTime() + MIGRATION_INTAKE_ASSISTED_RETENTION_DAYS * DAY);
    });

    it('gives a run the operator staged the shorter one', () => {
        expect(expiryFor(false, NOW).getTime())
            .toBe(NOW.getTime() + MIGRATION_INTAKE_STAGED_RETENTION_DAYS * DAY);
    });

    it('really is two different windows', () => {
        // Positive control for the pair above: they would both pass against a
        // function that ignored its argument if the two constants were equal.
        expect(MIGRATION_INTAKE_ASSISTED_RETENTION_DAYS)
            .not.toBe(MIGRATION_INTAKE_STAGED_RETENTION_DAYS);
        expect(expiryFor(true, NOW).getTime()).toBeGreaterThan(expiryFor(false, NOW).getTime());
    });
});

describe('MigrationAssistanceService.remindExpiring', () => {
    let db: TestDb;
    let sqlite: SqliteDatabase;
    let svc: MigrationAssistanceService;

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        sqlite = fix.sqlite;
        await setupSchema(sqlite);
        vi.mocked(mockDrizzle).mockReturnValue(asD1DrizzleReturn(db));
        await seedTenant(db, TENANT, 'a', 'owner-1');
        await db.insert(schema.users).values({
            id: 'insp-1', tenantId: TENANT, email: 'insp@example.test',
            passwordHash: 'x', role: 'inspector', createdAt: new Date(),
        });
        svc = new MigrationAssistanceService({} as D1Database);
    });

    afterEach(() => {
        sqlite.close();
        vi.clearAllMocks();
    });

    function notes() {
        return db.select().from(schema.notifications).all();
    }

    function batch(id: string) {
        return db.select().from(schema.migrationBatches)
            .where(eq(schema.migrationBatches.id, id)).get();
    }

    it('reminds a run inside the lead window and nobody else', async () => {
        await seed(db, 'b-soon', new Date(NOW.getTime() + (MIGRATION_INTAKE_REMINDER_LEAD_DAYS - 1) * DAY), 'needs_assistance');
        await seed(db, 'b-far', new Date(NOW.getTime() + (MIGRATION_INTAKE_REMINDER_LEAD_DAYS + 5) * DAY), 'needs_assistance');

        const result = await svc.remindExpiring(NOW);
        // Both numbers, always: a run that examined nothing must not read the
        // same as a run that found nothing to do.
        expect(result).toEqual({ scanned: 2, reminded: 1 });

        const written = await notes();
        expect(written).toHaveLength(1);
        expect(written[0]!.userId).toBe('owner-1');
        expect(written[0]!.entityId).toBe('b-soon');
        expect(written[0]!.entityType).toBe('migration_batch');
        // The far one is untouched, so it can still be reminded on its own day.
        expect(JSON.parse((await batch('b-far'))!.manifest)[MIGRATION_INTAKE_REMINDED_METADATA_KEY])
            .toBeUndefined();
    });

    it('does not remind twice about the same run, and still says it looked', async () => {
        await seed(db, 'b-soon', new Date(NOW.getTime() + 2 * DAY), 'needs_assistance');
        expect(await svc.remindExpiring(NOW)).toEqual({ scanned: 1, reminded: 1 });

        const second = await svc.remindExpiring(new Date(NOW.getTime() + DAY));
        // `scanned: 1` is the load-bearing half. A second pass that had stopped
        // seeing the run at all would also report `reminded: 0`, and that is a
        // broken job rather than a quiet one.
        expect(second).toEqual({ scanned: 1, reminded: 0 });
        expect(await notes()).toHaveLength(1);
    });

    it('reminds again once the mark is gone, so the mark is what silences it', async () => {
        // Positive control for the test above. Without this, "it stayed quiet"
        // could be caused by anything at all — the window, the status, the
        // notification path — rather than by the mark the design relies on.
        await seed(db, 'b-soon', new Date(NOW.getTime() + 2 * DAY), 'needs_assistance');
        await svc.remindExpiring(NOW);
        await db.update(schema.migrationBatches).set({ manifest: '{"warnings":[]}' })
            .where(eq(schema.migrationBatches.id, 'b-soon'));

        expect(await svc.remindExpiring(NOW)).toEqual({ scanned: 1, reminded: 1 });
        expect(await notes()).toHaveLength(2);
    });

    it('records the reminder on the run rather than in a second table', async () => {
        await seed(db, 'b-soon', new Date(NOW.getTime() + 2 * DAY), 'needs_assistance');
        // BEFORE: the manifest carries no such key, so its presence afterwards
        // is this pass's doing.
        expect(JSON.parse((await batch('b-soon'))!.manifest)[MIGRATION_INTAKE_REMINDED_METADATA_KEY])
            .toBeUndefined();

        await svc.remindExpiring(NOW);

        const manifest = JSON.parse((await batch('b-soon'))!.manifest);
        expect(manifest[MIGRATION_INTAKE_REMINDED_METADATA_KEY]).toBe(NOW.toISOString());
        // The rest of the manifest survives the mark — it is the record of what
        // the producing run read, and a reminder must not overwrite it.
        expect(manifest.warnings).toEqual([]);
    });

    it('reminds about a staged run too, not only an assisted one', async () => {
        await seed(db, 'b-staged', new Date(NOW.getTime() + 2 * DAY), 'staged');
        expect(await svc.remindExpiring(NOW)).toEqual({ scanned: 1, reminded: 1 });
    });

    it('says nothing about a run that has already gone past its date', async () => {
        // The sweep deletes it; a reminder about something already gone is
        // worse than silence. It is still counted as looked-at.
        await seed(db, 'b-gone', new Date(NOW.getTime() - DAY), 'needs_assistance');
        expect(await svc.remindExpiring(NOW)).toEqual({ scanned: 1, reminded: 0 });
        expect(await notes()).toHaveLength(0);
    });

    it('says nothing about a run that has been applied', async () => {
        await seed(db, 'b-done', new Date(NOW.getTime() + 2 * DAY), 'applied');
        // Not even looked at: a finished run has nothing at stake, so it is not
        // part of the population this job reports on.
        expect(await svc.remindExpiring(NOW)).toEqual({ scanned: 0, reminded: 0 });
    });

    it('says nothing about a run that carries no clock at all', async () => {
        await seed(db, 'b-forever', null, 'staged');
        expect(await svc.remindExpiring(NOW)).toEqual({ scanned: 0, reminded: 0 });
    });

    it('tells each workspace about its own run only', async () => {
        await seedTenant(db, OTHER_TENANT, 'b', 'owner-2');
        await seed(db, 'b-mine', new Date(NOW.getTime() + 2 * DAY), 'needs_assistance');
        await seed(db, 'b-theirs', new Date(NOW.getTime() + 2 * DAY), 'needs_assistance', { tenantId: OTHER_TENANT });

        expect(await svc.remindExpiring(NOW)).toEqual({ scanned: 2, reminded: 2 });

        const written = await notes();
        expect(written).toHaveLength(2);
        expect(written.find((n) => n.entityId === 'b-mine')?.userId).toBe('owner-1');
        expect(written.find((n) => n.entityId === 'b-mine')?.tenantId).toBe(TENANT);
        expect(written.find((n) => n.entityId === 'b-theirs')?.userId).toBe('owner-2');
        expect(written.find((n) => n.entityId === 'b-theirs')?.tenantId).toBe(OTHER_TENANT);
    });

    it('marks only the run it reminded about', async () => {
        await seedTenant(db, OTHER_TENANT, 'b', 'owner-2');
        await seed(db, 'b-mine', new Date(NOW.getTime() + 2 * DAY), 'needs_assistance');
        await seed(db, 'b-gone', new Date(NOW.getTime() - DAY), 'needs_assistance', { tenantId: OTHER_TENANT });

        await svc.remindExpiring(NOW);
        expect(JSON.parse((await batch('b-mine'))!.manifest)[MIGRATION_INTAKE_REMINDED_METADATA_KEY])
            .toBe(NOW.toISOString());
        // The past-due one keeps a clean manifest: it was never told, so nothing
        // may claim it was.
        expect(JSON.parse((await batch('b-gone'))!.manifest)[MIGRATION_INTAKE_REMINDED_METADATA_KEY])
            .toBeUndefined();
    });
});

describe('MigrationAssistanceService.notifyDelivered', () => {
    let db: TestDb;
    let sqlite: SqliteDatabase;

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        sqlite = fix.sqlite;
        await setupSchema(sqlite);
        vi.mocked(mockDrizzle).mockReturnValue(asD1DrizzleReturn(db));
        await seedTenant(db, TENANT, 'a', 'owner-1');
    });

    afterEach(() => {
        sqlite.close();
        vi.clearAllMocks();
    });

    it('tells the people who can act that the run is ready to review', async () => {
        const svc = new MigrationAssistanceService({} as D1Database);
        await svc.notifyDelivered(TENANT, 'b-1');
        const written = await db.select().from(schema.notifications).all();
        expect(written).toHaveLength(1);
        expect(written[0]!.entityId).toBe('b-1');
        expect(written[0]!.entityType).toBe('migration_batch');
        expect(written[0]!.title.length).toBeGreaterThan(0);
        // A DIFFERENT type from the expiry reminder. One string for both would
        // make the two indistinguishable to anything reading the feed.
        expect(written[0]!.type).toBe('migration_intake_ready');
    });

    it('does not reach an inspector, who cannot apply the run anyway', async () => {
        await db.insert(schema.users).values({
            id: 'insp-1', tenantId: TENANT, email: 'insp@example.test',
            passwordHash: 'x', role: 'inspector', createdAt: new Date(),
        });
        await new MigrationAssistanceService({} as D1Database).notifyDelivered(TENANT, 'b-1');
        const written = await db.select().from(schema.notifications).all();
        // Positive control on the same pass: a manager DOES get it, so the
        // absence above is about the role and not about the fan-out being empty.
        expect(written.map((n) => n.userId)).toEqual(['owner-1']);

        await db.insert(schema.users).values({
            id: 'mgr-1', tenantId: TENANT, email: 'mgr@example.test',
            passwordHash: 'x', role: 'manager', createdAt: new Date(),
        });
        await new MigrationAssistanceService({} as D1Database).notifyDelivered(TENANT, 'b-2');
        const second = await db.select().from(schema.notifications).all();
        expect(second.filter((n) => n.entityId === 'b-2').map((n) => n.userId).sort())
            .toEqual(['mgr-1', 'owner-1']);
    });

    it('does not reach another workspace', async () => {
        await seedTenant(db, OTHER_TENANT, 'b', 'owner-2');
        await new MigrationAssistanceService({} as D1Database).notifyDelivered(TENANT, 'b-1');
        const written = await db.select().from(schema.notifications).all();
        expect(written.map((n) => n.userId)).toEqual(['owner-1']);
    });
});
