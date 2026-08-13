/**
 * The roster accessor — one answer to "who worked this inspection".
 *
 * The fourth test is the point of the module: it asserts on the SQL, not on the
 * result, because an implementation that fell back to `inspections.inspector_id`
 * would pass a result-only test while reintroducing the ability for two callers
 * to get two different answers. It was proven to go red against a deliberately
 * wrong implementation that reads the column (see the comment on that test).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { getInspectionRoster, getInspectionRosters } from '../../../server/lib/inspection/roster';

const TENANT = 'tenant-roster-1';
const OTHER = 'tenant-roster-2';
const INSP = 'insp-1';
const UNASSIGNED = 'insp-2';
const LEAD = 'user-lead';
const HELPER = 'user-helper';

describe('getInspectionRoster', () => {
    let db: BetterSQLite3Database<typeof schema>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sqlite: any;

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);

        for (const id of [TENANT, OTHER]) {
            await db.insert(schema.tenants).values({
                id, slug: id, createdAt: new Date(),
            });
        }
        for (const [id, name] of [[LEAD, 'Dana Okoye'], [HELPER, 'Sam Reyes']] as const) {
            await db.insert(schema.users).values({
                id, tenantId: TENANT, email: `${id}@example.com`, passwordHash: 'x',
                name, role: 'inspector', createdAt: new Date(),
            } as never);
        }
        await db.insert(schema.inspectionInspectors).values([
            { inspectionId: INSP, userId: LEAD, tenantId: TENANT, role: 'lead', createdAt: new Date() },
            { inspectionId: INSP, userId: HELPER, tenantId: TENANT, role: 'helper', createdAt: new Date() },
        ]);
    });

    afterEach(() => { sqlite.close(); });

    it('returns the lead and helpers from the link table', async () => {
        const roster = await getInspectionRoster(db as never, TENANT, INSP);
        expect(roster.lead?.id).toBe(LEAD);
        expect(roster.lead?.name).toBe('Dana Okoye');
        expect(roster.helpers.map(h => h.id)).toEqual([HELPER]);
    });

    it('is tenant-scoped', async () => {
        // A roster that leaks across tenants leaks who works for whom.
        const roster = await getInspectionRoster(db as never, OTHER, INSP);
        expect(roster.lead).toBeNull();
        expect(roster.helpers).toEqual([]);
    });

    it('returns a null lead rather than throwing when the roster is empty', async () => {
        // Pre-backfill rows exist in production. Callers must render
        // "unassigned" rather than crash.
        const roster = await getInspectionRoster(db as never, TENANT, UNASSIGNED);
        expect(roster.lead).toBeNull();
        expect(roster.helpers).toEqual([]);
    });

    it('does not read inspections.inspector_id', async () => {
        // Asserted on the executed SQL, not the result. Proven red first: an
        // implementation that resolved the lead from `inspections` returned the
        // same roster and passed every other test in this file, which is
        // exactly the failure mode this test exists for.
        const statements: string[] = [];
        const spy = sqlite.prepare.bind(sqlite);
        sqlite.prepare = (sql: string) => { statements.push(sql); return spy(sql); };

        await getInspectionRoster(db as never, TENANT, INSP);
        sqlite.prepare = spy;

        expect(statements.length).toBeGreaterThan(0);
        expect(statements.join(' ')).not.toMatch(/\binspections\b/);
        expect(statements.join(' ')).toMatch(/inspection_inspectors/);
    });

    it('batches many inspections into one query', async () => {
        // The calendar and the inspections list render many rows; a per-row
        // accessor would turn one query into N.
        await db.insert(schema.inspectionInspectors).values([
            { inspectionId: 'insp-3', userId: LEAD, tenantId: TENANT, role: 'lead', createdAt: new Date() },
        ]);
        const statements: string[] = [];
        const spy = sqlite.prepare.bind(sqlite);
        sqlite.prepare = (sql: string) => { statements.push(sql); return spy(sql); };

        const map = await getInspectionRosters(db as never, TENANT, [INSP, 'insp-3', UNASSIGNED]);
        sqlite.prepare = spy;

        expect(statements).toHaveLength(1);
        expect(map.get(INSP)?.lead?.id).toBe(LEAD);
        expect(map.get('insp-3')?.lead?.id).toBe(LEAD);
        expect(map.has(UNASSIGNED)).toBe(false);
    });

    it('asks for nothing when given no ids', async () => {
        const statements: string[] = [];
        const spy = sqlite.prepare.bind(sqlite);
        sqlite.prepare = (sql: string) => { statements.push(sql); return spy(sql); };

        const map = await getInspectionRosters(db as never, TENANT, []);
        sqlite.prepare = spy;

        expect(statements).toHaveLength(0);
        expect(map.size).toBe(0);
    });
});
