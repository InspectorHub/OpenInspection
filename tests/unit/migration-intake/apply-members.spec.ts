/**
 * Applying member rows.
 *
 * Members are never overwritten. The mutable fields on a member are the role
 * and the capability toggles, so "overwrite" would mean changing somebody's
 * permissions by uploading a spreadsheet — while the deliberate path for that
 * invalidates their session and their outstanding authorisations. An import
 * may add people; it may not re-grant power.
 *
 * The seat rule is whole-batch and it is measured in SEATS, not in rows: an
 * invitation somebody else already sent is holding one, and a batch admitted
 * against headroom that invitation has spoken for takes the workspace over its
 * cap as soon as both are accepted. Every refusal here has a positive control
 * that admits the same batch once the seat is genuinely free, so a refusal can
 * never be a check that simply says no.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Database as SqliteDatabase } from 'better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { asD1DrizzleReturn } from '../helpers/test-db';
import { withBatch } from '../helpers/d1-binding';
import type {
    BundleMember,
    EntityCounts,
    MigrationBundleV1,
} from '../../../server/lib/migration-intake/bundle';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { MigrationStageService } from '../../../server/services/migration-intake/stage.service';
import { limitsFor } from '../../../server/lib/migration-intake/limits';
import { SAAS_PROFILE } from '../../../server/lib/deployment-profile';
import { MigrationApplyService } from '../../../server/services/migration-intake/apply.service';

const TENANT = '11111111-1111-1111-1111-1111111111a1';
const USER = '22222222-2222-2222-2222-2222222222b2';
const LIMITS = limitsFor(SAAS_PROFILE);
const FUTURE = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

const EMPTY: EntityCounts = { readFromSource: 0, emitted: 0, dropped: [] };

function membersBundle(list: BundleMember[]): MigrationBundleV1 {
    return {
        formatVersion: 1,
        manifest: {
            source: { vendor: 'csv_generic' },
            adapter: { name: 'csv-generic', version: '1' },
            counts: {
                template: EMPTY,
                contact: EMPTY,
                member: { readFromSource: list.length, emitted: list.length, dropped: [] },
            },
            warnings: [],
        },
        templates: [],
        contacts: [],
        members: list,
    };
}

function freshMembers(n: number): BundleMember[] {
    return Array.from({ length: n }, (_, i) => ({ email: `p${i}@example.test`, role: 'inspector' as const }));
}

describe('MigrationApplyService — member rows', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: SqliteDatabase;
    let stage: MigrationStageService;
    let apply: MigrationApplyService;

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        sqlite = fix.sqlite;
        await setupSchema(sqlite);
        // The staging step batches its writes, and better-sqlite3 is the one
        // Drizzle driver with no `batch()` — see helpers/d1-binding.ts.
        vi.mocked(mockDrizzle).mockReturnValue(asD1DrizzleReturn(withBatch(db, sqlite)));
        await db.insert(schema.tenants).values({
            id: TENANT, slug: 'a', status: 'active', deploymentMode: 'shared',
            tier: 'free', maxUsers: 12, createdAt: new Date(),
        });
        stage = new MigrationStageService({} as D1Database);
        apply = new MigrationApplyService({} as D1Database);
    });

    afterEach(() => {
        sqlite.close();
        vi.clearAllMocks();
    });

    async function seedMember(id: string, email: string, role: 'owner' | 'inspector' = 'inspector') {
        await db.insert(schema.users).values({
            id, tenantId: TENANT, email, passwordHash: 'x', role, createdAt: new Date(),
        });
    }

    async function seedInvite(id: string, email: string) {
        await db.insert(schema.tenantInvites).values({
            id, tenantId: TENANT, email, role: 'inspector', status: 'pending', expiresAt: FUTURE(),
        });
    }

    async function setCap(maxUsers: number) {
        await db.update(schema.tenants).set({ maxUsers }).where(eq(schema.tenants.id, TENANT));
    }

    async function stageMembers(list: BundleMember[]) {
        return stage.stage({
            tenantId: TENANT, createdBy: USER, limits: LIMITS, intent: 'members.invite', bundle: membersBundle(list),
        });
    }

    it('creates one pending invite per row and hands the dispatch list back', async () => {
        const staged = await stageMembers([
            { email: 'one@example.test', name: 'One', role: 'inspector' },
            { email: 'two@example.test', role: 'manager' },
        ]);
        const result = await apply.apply({
            tenantId: TENANT, batchId: staged.batchId, conflictPolicy: 'skip', seatQuotaEnforced: true,
        });

        expect(result).toMatchObject({ status: 'applied', applied: 2, skipped: 0, failed: 0 });
        expect(result.invites.map((i) => i.email).sort())
            .toEqual(['one@example.test', 'two@example.test']);
        expect(result.invites.every((i) => typeof i.token === 'string' && i.token.length > 0)).toBe(true);
        // Delivery is the caller's job, so the dispatch entry has to say which
        // staged row it came from — otherwise a send failure cannot be reported
        // against anything.
        const rowIds = (await db.select().from(schema.migrationRows)
            .where(eq(schema.migrationRows.batchId, staged.batchId)).all()).map((r) => r.id);
        expect(result.invites.map((i) => i.rowId).sort()).toEqual([...rowIds].sort());

        const invites = await db.select().from(schema.tenantInvites).all();
        expect(invites).toHaveLength(2);
        expect(invites.every((i) => i.status === 'pending')).toBe(true);
        expect(invites.find((i) => i.email === 'two@example.test')?.role).toBe('manager');
    });

    it('records the invite token as the row it created, so the undo can find it', async () => {
        const staged = await stageMembers([{ email: 'one@example.test', role: 'inspector' }]);
        const result = await apply.apply({
            tenantId: TENANT, batchId: staged.batchId, conflictPolicy: 'skip', seatQuotaEnforced: true,
        });
        const row = await db.select().from(schema.migrationRows)
            .where(eq(schema.migrationRows.batchId, staged.batchId)).get();
        expect(row?.status).toBe('applied');
        expect(row?.createdId).toBe(result.invites[0].token);
        // Nothing was replaced, so there is nothing for an undo to put back.
        expect(row?.priorState).toBeNull();
    });

    it('skips an existing member by name rather than changing their role', async () => {
        await seedMember('u1', 'one@example.test');
        const staged = await stageMembers([{ email: 'one@example.test', role: 'owner' }]);
        const result = await apply.apply({
            tenantId: TENANT, batchId: staged.batchId, conflictPolicy: 'overwrite', seatQuotaEnforced: true,
        });

        expect(result).toMatchObject({ applied: 0, skipped: 1 });
        const live = await db.select().from(schema.users).where(eq(schema.users.id, 'u1')).get();
        expect(live?.role).toBe('inspector');
        // Not invited either: a skip that also sent an invitation would be two
        // outcomes for one row.
        expect(await db.select().from(schema.tenantInvites).all()).toEqual([]);
        expect(result.invites).toEqual([]);

        const row = await db.select().from(schema.migrationRows)
            .where(eq(schema.migrationRows.batchId, staged.batchId)).get();
        expect(row?.outcome).toMatch(/one@example\.test/);
    });

    it('refuses the whole batch when there are not enough seats, writing nothing', async () => {
        await setCap(3);
        await seedMember('u1', 'boss@example.test', 'owner');
        const staged = await stageMembers(freshMembers(4));

        await expect(apply.apply({
            tenantId: TENANT, batchId: staged.batchId, conflictPolicy: 'skip', seatQuotaEnforced: true,
        })).rejects.toThrow(/needs 4 seats and 2 are available/);

        expect(await db.select().from(schema.tenantInvites).all()).toEqual([]);
        const rows = await db.select().from(schema.migrationRows)
            .where(eq(schema.migrationRows.batchId, staged.batchId)).all();
        expect(rows).toHaveLength(4);
        expect(rows.every((r) => r.status === 'pending')).toBe(true);
        // A batch parked at `applying` by a refusal reads afterwards as a run
        // that started and stopped, and a retry of it would look like the
        // resumption of something that never ran.
        const batch = await db.select().from(schema.migrationBatches)
            .where(eq(schema.migrationBatches.id, staged.batchId)).get();
        expect(batch?.status).toBe('staged');
        expect(batch?.appliedAt).toBeNull();
    });

    it('positive control: the same batch applies whole once the seats are there', async () => {
        await setCap(5);
        await seedMember('u1', 'boss@example.test', 'owner');
        const staged = await stageMembers(freshMembers(4));

        const result = await apply.apply({
            tenantId: TENANT, batchId: staged.batchId, conflictPolicy: 'skip', seatQuotaEnforced: true,
        });

        expect(result).toMatchObject({ status: 'applied', applied: 4, failed: 0 });
        expect(await db.select().from(schema.tenantInvites).all()).toHaveLength(4);
    });

    it('counts an invitation somebody else already sent against the batch', async () => {
        await setCap(3);
        await seedMember('u1', 'boss@example.test', 'owner');
        // One member row, but TWO seats held: this invitation can be accepted at
        // any moment. A batch measured in rows would see two seats free here.
        await seedInvite('earlier', 'earlier@example.test');
        const staged = await stageMembers(freshMembers(2));

        await expect(apply.apply({
            tenantId: TENANT, batchId: staged.batchId, conflictPolicy: 'skip', seatQuotaEnforced: true,
        })).rejects.toThrow(/needs 2 seats and 1 are available/);

        expect(await db.select().from(schema.tenantInvites).all()).toHaveLength(1);
    });

    it('positive control: the same batch and cap without that invitation applies', async () => {
        await setCap(3);
        await seedMember('u1', 'boss@example.test', 'owner');
        const staged = await stageMembers(freshMembers(2));

        const result = await apply.apply({
            tenantId: TENANT, batchId: staged.batchId, conflictPolicy: 'skip', seatQuotaEnforced: true,
        });

        expect(result).toMatchObject({ applied: 2, failed: 0 });
    });

    it('does not count rows that will be skipped towards the seats needed', async () => {
        await setCap(2);
        await seedMember('u1', 'known@example.test');
        const staged = await stageMembers([
            { email: 'known@example.test', role: 'inspector' },
            { email: 'fresh@example.test', role: 'inspector' },
        ]);
        const result = await apply.apply({
            tenantId: TENANT, batchId: staged.batchId, conflictPolicy: 'skip', seatQuotaEnforced: true,
        });
        expect(result).toMatchObject({ applied: 1, skipped: 1, failed: 0 });
    });

    it('ignores the cap entirely where the deployment has no seat quota', async () => {
        await setCap(1);
        const staged = await stageMembers(freshMembers(3));
        const result = await apply.apply({
            tenantId: TENANT, batchId: staged.batchId, conflictPolicy: 'skip', seatQuotaEnforced: false,
        });
        expect(result.applied).toBe(3);
        expect(await db.select().from(schema.tenantInvites).all()).toHaveLength(3);
    });

    it('carries the invited role and the capability toggles onto the invitation', async () => {
        const staged = await stageMembers([
            { email: 'boss@example.test', role: 'manager', permissionOverrides: { templateDelete: false } },
        ]);
        await apply.apply({
            tenantId: TENANT, batchId: staged.batchId, conflictPolicy: 'skip', seatQuotaEnforced: true,
        });
        const invite = await db.select().from(schema.tenantInvites).get();
        expect(invite?.role).toBe('manager');
        // Stored as a DIFF against the role template, which is why the toggle
        // asserted here is one a manager holds by default: an override equal to
        // the template is not an override.
        expect(invite?.permissionOverrides).toEqual({ templateDelete: false });
    });

    /**
     * The constraint that survives a bad row being allowed to STAGE.
     *
     * The staging format now carries an entry whose address is not one, so that
     * somebody can be shown it and correct it. What must not follow is an
     * invitation going anywhere on the strength of it — the address IS the
     * delivery instruction, and a row that cannot say where the invitation goes
     * cannot produce one.
     *
     * Every refusal below is paired with the SAME row corrected and applied, so
     * "no invitation was created" can never be a check that simply says no.
     */
    describe('an address that is not one never becomes an invitation', () => {
        /** What a repair writes, without going through the repair service's file reads. */
        async function rewriteRow(batchId: string, position: number, payload: BundleMember) {
            const row = (await db.select().from(schema.migrationRows)
                .where(eq(schema.migrationRows.batchId, batchId)).all())
                .find((r) => r.position === position)!;
            await db.update(schema.migrationRows)
                .set({ payload: JSON.stringify(payload) })
                .where(eq(schema.migrationRows.id, row.id));
            return row.id;
        }

        it('fails the malformed row, invites the good one, and sends nothing to the bad address', async () => {
            const staged = await stageMembers([
                { email: 'good@example.test', role: 'inspector' },
                { email: 'not-an-address', role: 'inspector' },
                { email: 'agentish@example.test', role: 'agent' },
            ]);

            const result = await apply.apply({
                tenantId: TENANT, batchId: staged.batchId, conflictPolicy: 'skip', seatQuotaEnforced: true,
            });

            // The buckets add up over the whole run, so "one failed" cannot be
            // true of a run where everything failed.
            expect(result).toMatchObject({ status: 'partially_applied', applied: 1, skipped: 0, failed: 2 });
            expect(result.invites.map((i) => i.email)).toEqual(['good@example.test']);

            const invites = await db.select().from(schema.tenantInvites).all();
            expect(invites.map((i) => i.email)).toEqual(['good@example.test']);

            // The reason travels with the row, and it is the describer's own
            // sentence rather than a database error the operator cannot act on.
            const rows = await db.select().from(schema.migrationRows)
                .where(eq(schema.migrationRows.batchId, staged.batchId)).all();
            const byPosition = new Map(rows.map((r) => [r.position, r]));
            expect(byPosition.get(0)?.status).toBe('applied');
            expect(byPosition.get(1)?.status).toBe('failed');
            expect(byPosition.get(1)?.outcome).toMatch(/does not look like an email address/);
            expect(byPosition.get(2)?.status).toBe('failed');
            expect(byPosition.get(2)?.outcome).toMatch(/per inspection/);
            expect(byPosition.get(1)?.createdId).toBeNull();
            expect(byPosition.get(2)?.createdId).toBeNull();
        });

        it('positive control: the same rows, corrected, ARE invited', async () => {
            const staged = await stageMembers([
                { email: 'good@example.test', role: 'inspector' },
                { email: 'not-an-address', role: 'inspector' },
                { email: 'agentish@example.test', role: 'agent' },
            ]);
            await rewriteRow(staged.batchId, 1, { email: 'fixed@example.test', role: 'inspector' });
            await rewriteRow(staged.batchId, 2, { email: 'agentish@example.test', role: 'inspector' });

            const result = await apply.apply({
                tenantId: TENANT, batchId: staged.batchId, conflictPolicy: 'skip', seatQuotaEnforced: true,
            });

            expect(result).toMatchObject({ status: 'applied', applied: 3, failed: 0 });
            expect((await db.select().from(schema.tenantInvites).all()).map((i) => i.email).sort())
                .toEqual(['agentish@example.test', 'fixed@example.test', 'good@example.test']);
        });

        it('leaves a row with no address at all uninvited, and says where an invitation would go', async () => {
            const staged = await stageMembers([
                { email: 'good@example.test', role: 'inspector' },
                { email: '', role: 'inspector' },
            ]);
            const result = await apply.apply({
                tenantId: TENANT, batchId: staged.batchId, conflictPolicy: 'skip', seatQuotaEnforced: true,
            });
            expect(result).toMatchObject({ applied: 1, failed: 1 });
            expect((await db.select().from(schema.tenantInvites).all()).map((i) => i.email))
                .toEqual(['good@example.test']);
            const rows = await db.select().from(schema.migrationRows)
                .where(eq(schema.migrationRows.batchId, staged.batchId)).all();
            expect(rows.find((r) => r.position === 1)?.outcome).toMatch(/nowhere else to go/);
        });

        it('does not spend a seat on a row that can never be invited', async () => {
            // Two seats free, three rows, one of which is unwritable. Counting it
            // would refuse the whole batch over capacity nothing was ever going
            // to take — and would quote a number the operator cannot reconcile
            // with anything on their screen.
            await setCap(3);
            await seedMember('u1', 'boss@example.test', 'owner');
            const staged = await stageMembers([
                { email: 'a@example.test', role: 'inspector' },
                { email: 'b@example.test', role: 'inspector' },
                { email: 'not-an-address', role: 'inspector' },
            ]);

            const result = await apply.apply({
                tenantId: TENANT, batchId: staged.batchId, conflictPolicy: 'skip', seatQuotaEnforced: true,
            });
            expect(result).toMatchObject({ applied: 2, failed: 1 });
        });

        it('positive control: the same batch IS refused once that row is a real address', async () => {
            // The seat rule has not been weakened — only the count of what can
            // actually take a seat has changed. Correct the third row and the
            // batch needs three, which is one more than there is room for.
            await setCap(3);
            await seedMember('u1', 'boss@example.test', 'owner');
            const staged = await stageMembers([
                { email: 'a@example.test', role: 'inspector' },
                { email: 'b@example.test', role: 'inspector' },
                { email: 'not-an-address', role: 'inspector' },
            ]);
            await rewriteRow(staged.batchId, 2, { email: 'c@example.test', role: 'inspector' });

            await expect(apply.apply({
                tenantId: TENANT, batchId: staged.batchId, conflictPolicy: 'skip', seatQuotaEnforced: true,
            })).rejects.toThrow(/needs 3 seats and 2 are available/);
            expect(await db.select().from(schema.tenantInvites).all()).toEqual([]);
        });
    });
});
