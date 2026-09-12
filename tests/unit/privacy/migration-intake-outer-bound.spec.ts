/**
 * An import run may never outlive its own upload by more than the period the
 * retention catalogue declares for it.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 * `migration_batches` declares ninety days. Apply used to reset `expires_at` to
 * thirty days from the apply instant with nothing above it, and a reset that
 * cannot be exceeded is not a window, it is an extension. The assisted path
 * compounded it: a waiting run carries ninety days from upload, the staff
 * delivery moves it to `staged` without touching that clock, and an apply on
 * day eighty-nine wrote a fresh thirty. Apply does not rewrite the uploaded
 * file, so the object that reached day one hundred and nineteen was the
 * original upload — a third party's name, email address and phone number, under
 * a rule declaring ninety.
 *
 * A retention control that does not enforce its own declared limit is not a
 * control, and correcting the prose would not have addressed it. The scenarios
 * below are the ones that have to hold for the declared limit to mean anything.
 *
 * ── What is asserted, and what would make it vacuous ────────────────────────
 * The bound is read from `MIGRATION_INTAKE_ASSISTED_RETENTION_DAYS` rather than
 * written as `90` here: a test carrying its own copy of the window agrees with
 * a change to the real one and stops measuring it.
 *
 * Every case also asserts the UNCLAMPED value the old code would have written.
 * Without that, a fix that quietly stopped moving the clock at all would pass
 * every assertion below while destroying the undo window — and so would a fix
 * that never ran, on a scenario whose numbers happened not to collide.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Database as SqliteDatabase } from 'better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { asD1DrizzleReturn } from '../helpers/test-db';
import { withBatch } from '../helpers/d1-binding';
import type { EntityCounts, MigrationBundleV1 } from '../../../server/lib/migration-intake/bundle';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { MigrationStageService } from '../../../server/services/migration-intake/stage.service';
import { MigrationApplyService } from '../../../server/services/migration-intake/apply.service';
import { expiryFor, appliedExpiry, outerExpiryBound } from '../../../server/services/migration-intake/assistance.service';
import { limitsFor } from '../../../server/lib/migration-intake/limits';
import {
    MIGRATION_INTAKE_ASSISTED_RETENTION_DAYS,
    MIGRATION_INTAKE_STAGED_RETENTION_DAYS,
} from '../../../server/lib/compliance/retention-windows';
import { SAAS_PROFILE } from '../../../server/lib/deployment-profile';

const TENANT = '11111111-1111-1111-1111-1111111111a1';
const USER = '22222222-2222-2222-2222-2222222222b2';
const LIMITS = limitsFor(SAAS_PROFILE);
const DAY = 24 * 60 * 60 * 1000;

/** Day 0 of every scenario below. Fixed, so a failure reads the same twice. */
const UPLOADED_AT = new Date('2026-03-01T09:00:00.000Z');
const day = (n: number) => new Date(UPLOADED_AT.getTime() + n * DAY);

const EMPTY: EntityCounts = { readFromSource: 0, emitted: 0, dropped: [] };

function contactsBundle(): MigrationBundleV1 {
    return {
        formatVersion: 1,
        manifest: {
            source: { vendor: 'csv_generic' },
            adapter: { name: 'csv-generic', version: '1' },
            counts: {
                template: EMPTY,
                contact: { readFromSource: 1, emitted: 1, dropped: [] },
                member: EMPTY,
            },
            warnings: [],
        },
        templates: [],
        contacts: [{ name: 'P0', email: 'p0@example.test', type: 'client' }],
        members: [],
    };
}

describe('an applied run cannot outlive its own upload by more than the declared window', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: SqliteDatabase;
    let stage: MigrationStageService;
    let apply: MigrationApplyService;

    beforeEach(async () => {
        vi.useFakeTimers();
        const fix = createTestDb();
        db = fix.db;
        sqlite = fix.sqlite;
        await setupSchema(sqlite);
        vi.mocked(mockDrizzle).mockReturnValue(asD1DrizzleReturn(withBatch(db, sqlite)));
        await db.insert(schema.tenants).values({
            id: TENANT, slug: 'a', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        stage = new MigrationStageService({} as D1Database);
        apply = new MigrationApplyService({} as D1Database);
    });

    afterEach(() => {
        vi.useRealTimers();
        sqlite.close();
        vi.clearAllMocks();
    });

    /**
     * A run uploaded on day 0 carrying `dueOnDay` as its clock.
     *
     * The clock is passed rather than defaulted because which of the two
     * lifetimes a run has is the whole variable here: thirty for one the
     * operator staged, ninety for one waiting on a person.
     */
    async function uploadedOnDayZero(dueOnDay: number): Promise<string> {
        vi.setSystemTime(UPLOADED_AT);
        const r = await stage.stage({
            tenantId: TENANT, createdBy: USER, intent: 'contacts.import',
            bundle: contactsBundle(), limits: LIMITS,
            sourceKey: `${TENANT}/migration-intake/src.csv`,
            expiresAt: day(dueOnDay),
        });
        const row = await batchRow(r.batchId);
        // The premise, asserted rather than assumed. If staging ever stopped
        // writing `created_at` from the clock, every bound below would be
        // measured from the wrong instant and would still pass.
        expect(row?.createdAt?.getTime()).toBe(UPLOADED_AT.getTime());
        expect(row?.expiresAt?.getTime()).toBe(day(dueOnDay).getTime());
        return r.batchId;
    }

    function batchRow(batchId: string) {
        return db.select().from(schema.migrationBatches)
            .where(eq(schema.migrationBatches.id, batchId)).get();
    }

    async function applyOnDay(batchId: string, n: number) {
        vi.setSystemTime(day(n));
        await apply.apply({ tenantId: TENANT, batchId, conflictPolicy: 'skip', seatQuotaEnforced: false });
        return batchRow(batchId);
    }

    const boundDay = MIGRATION_INTAKE_ASSISTED_RETENTION_DAYS;

    it('day 0 upload, day 29 apply — a full undo window, still inside the bound', async () => {
        const batchId = await uploadedOnDayZero(MIGRATION_INTAKE_STAGED_RETENTION_DAYS);
        const after = await applyOnDay(batchId, 29);

        // The undo window is intact: this is the case the reset exists for, and
        // clamping to "never move the date" would have left it at one day.
        expect(after?.expiresAt?.getTime())
            .toBe(day(29 + MIGRATION_INTAKE_STAGED_RETENTION_DAYS).getTime());
        expect(after?.expiresAt?.getTime()).toBeLessThanOrEqual(day(boundDay).getTime());
    });

    it('day 0 assisted upload, day 85 delivery, day 89 apply — clamped to the bound, not extended past it', async () => {
        // A waiting run's clock. The delivery that turns it into a staged run
        // does not touch `expires_at`, which is why day 89 is reachable at all.
        const batchId = await uploadedOnDayZero(boundDay);

        const unclamped = expiryFor(false, day(89));
        // The defect, stated as a number before the fix is exercised. If this
        // ever stops being true the scenario has drifted and the assertion
        // below proves nothing.
        expect(unclamped.getTime()).toBeGreaterThan(day(boundDay).getTime());
        expect((unclamped.getTime() - UPLOADED_AT.getTime()) / DAY).toBe(119);

        const after = await applyOnDay(batchId, 89);

        expect(after?.expiresAt?.getTime()).toBe(day(boundDay).getTime());
        expect(after?.expiresAt?.getTime()).toBeLessThan(unclamped.getTime());
    });

    it('holds for every apply day across both lifetimes, not only the two worked through above', () => {
        // The two scenarios above are worked examples. This is the property
        // they are instances of, checked on the pure function so a
        // day nobody thought to name cannot be the one that escapes.
        for (const dueDay of [MIGRATION_INTAKE_STAGED_RETENTION_DAYS, boundDay]) {
            for (let applyDay = 0; applyDay <= dueDay; applyDay++) {
                const written = appliedExpiry(UPLOADED_AT, day(applyDay));
                expect(written.getTime()).toBeLessThanOrEqual(day(boundDay).getTime());
                // And it never shortens what apply was going to give: the clamp
                // is a ceiling, not a second policy.
                expect(written.getTime())
                    .toBe(Math.min(expiryFor(false, day(applyDay)).getTime(), day(boundDay).getTime()));
            }
        }
    });

    it('measures the bound from the upload, not from the last write', () => {
        // The distinction the ruling turns on. `expires_at` is rewritten by
        // apply; `created_at` is not, and the uploaded file is not either — so
        // the only instant that answers "how long has this person's data been
        // here" is the one the run was created at.
        expect(outerExpiryBound(UPLOADED_AT).getTime()).toBe(day(boundDay).getTime());
        expect(outerExpiryBound(day(30)).getTime()).toBe(day(30 + boundDay).getTime());
    });
});
