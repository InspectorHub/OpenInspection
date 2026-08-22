/**
 * A real upload with bad rows in it, all the way to the screen and back.
 *
 * Every other spec around this one holds one link of the chain. This one holds
 * the claim the change was made for: **a bad row fails the ROW, not the UPLOAD,
 * and the reason is displayed against that row.** It drives the actual HTTP
 * routes — the multipart upload, the report the repair screen reads, the repair
 * write, and the apply — because each of those was individually capable of
 * being right while the operator still lost their file.
 *
 * What it refuses to accept as evidence:
 *
 *  - "the upload succeeded" — true of a run that staged nothing useful, so the
 *    three buckets are asserted to be mutually exclusive and to sum to the total.
 *  - "there is a problem row" — true of a run where EVERY row is a problem, so
 *    the good rows are asserted to have stayed good, by name.
 *  - "the report says three" — a count is not a sentence, so each problem row is
 *    asserted to carry its OWN reason, and the three reasons are asserted to be
 *    three different sentences.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Database as SqliteDatabase } from 'better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import { withBatch } from '../helpers/d1-binding';
import * as schema from '../../../server/lib/db/schema';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { asD1DrizzleReturn } from '../helpers/test-db';
import {
    intakeRequest,
    jsonBody,
    seedIntakeTenant,
    type IntakeAppOpts,
} from '../helpers/migration-intake-routes-harness';

/**
 * Five staff rows: two that are fine, and one for each fault the describer has a
 * sentence for. Nothing here is exotic — an empty cell, a typo, and somebody who
 * wrote the word they use for an agent in the role column.
 */
const MEMBERS_CSV = [
    'Email,Name,Role',
    'alice@example.test,Alice Ng,inspector',
    ',Bob Ray,inspector',
    'not-an-address,Cara Lin,inspector',
    'dan@example.test,Dan Roe,agent',
    'eve@example.test,Eve Sun,manager',
].join('\n');

/** One contact with no address at all, which the product's own copy calls fine. */
const CONTACTS_CSV = [
    'Full Name,Email',
    'Alice Ng,alice@example.test',
    'Bob Ray,',
].join('\n');

interface ProblemRow {
    rowId: string;
    entity: string;
    position: number;
    field?: string;
    reason: string;
    value?: string;
    suggestion?: string;
    payloadEcho: Record<string, unknown>;
}

interface Report {
    counts: { total: number; ok: number; conflicts: number; problems: number };
    problemRows: ProblemRow[];
    problemRowsTotal: number;
    blockedReason: string | null;
}

describe('an upload with three bad rows shows three rows, each with its own reason', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: SqliteDatabase;
    let store: Map<string, Uint8Array>;
    let opts: IntakeAppOpts;

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        sqlite = fix.sqlite;
        await setupSchema(sqlite);
        vi.mocked(mockDrizzle).mockReturnValue(asD1DrizzleReturn(withBatch(db, sqlite)));
        store = new Map();
        opts = { store };
        await seedIntakeTenant(db);
    });

    /** The multipart upload, exactly as the wizard sends it. */
    async function upload(intent: string, text: string): Promise<string> {
        const fd = new FormData();
        fd.append('intent', intent);
        // The declaration the picker sends. Every spreadsheet import is the one
        // tabular source, whichever product exported it.
        fd.append('vendor', 'csv_generic');
        fd.append('uploadAuthorized', 'true');
        fd.append('file', new File([text], 'export.csv', { type: 'text/csv' }));
        const res = await intakeRequest(opts, '/api/imports', { method: 'POST', body: fd });
        expect(res.status).toBe(201);
        const body = await res.json() as { data: { batchId: string; status: string } };
        expect(body.data.status).toBe('staged');
        return body.data.batchId;
    }

    async function report(batchId: string): Promise<Report> {
        const res = await intakeRequest(opts, `/api/imports/${batchId}`);
        expect(res.status).toBe(200);
        return (await res.json() as { data: Report }).data;
    }

    /** The buckets are exclusive and complete, asserted on every read. */
    function expectBucketsClose(r: Report, total: number, problems: number): void {
        expect(r.counts.total).toBe(total);
        expect(r.counts.problems).toBe(problems);
        expect(r.counts.ok + r.counts.conflicts + r.counts.problems).toBe(r.counts.total);
        expect(r.problemRowsTotal).toBe(problems);
        expect(r.problemRows).toHaveLength(problems);
    }

    it('stages all five rows, and the report names the three that need a person', async () => {
        const batchId = await upload('members.invite', MEMBERS_CSV);
        const r = await report(batchId);

        // THE WHOLE FILE ARRIVED. Under the rule this replaces, the upload
        // returned 422 and there was no run to read at all.
        expectBucketsClose(r, 5, 3);
        expect(r.counts.ok).toBe(2);
        expect(r.counts.conflicts).toBe(0);

        // Each row carries its own sentence, and the three are three DIFFERENT
        // sentences rather than one banner repeated.
        expect(r.problemRows.map((p) => p.position)).toEqual([1, 2, 3]);
        expect(new Set(r.problemRows.map((p) => p.reason)).size).toBe(3);
        expect(r.problemRows[0]).toMatchObject({ field: 'email' });
        expect(r.problemRows[0].reason).toMatch(/nowhere else to go/);
        expect(r.problemRows[1]).toMatchObject({ field: 'email', value: 'not-an-address' });
        expect(r.problemRows[1].reason).toMatch(/does not look like an email address/);
        expect(r.problemRows[2]).toMatchObject({ field: 'role', value: 'agent', suggestion: 'inspector' });
        expect(r.problemRows[2].reason).toMatch(/per inspection/);

        // The screen edits one field and sends the whole entry back, so the rest
        // of the entry has to come with the problem.
        expect(r.problemRows[1].payloadEcho).toMatchObject({ name: 'Cara Lin', role: 'inspector' });

        // The good rows stayed good, BY NAME — "two are ok" would also be true
        // if the wrong two were.
        const rows = await db.select().from(schema.migrationRows).all();
        const problemIds = new Set(r.problemRows.map((p) => p.rowId));
        const goodEmails = rows
            .filter((row) => !problemIds.has(row.id))
            .map((row) => (JSON.parse(row.payload) as { email: string }).email)
            .sort();
        expect(goodEmails).toEqual(['alice@example.test', 'eve@example.test']);

        // And the run is held: the banner names the count and points down at the
        // rows rather than describing the file.
        expect(r.blockedReason).toMatch(/3 entries cannot be imported as written/);
    });

    it('empties the bucket one row at a time, and only then unblocks the run', async () => {
        const batchId = await upload('members.invite', MEMBERS_CSV);
        const before = await report(batchId);

        const fixes = [
            { email: 'bob@example.test', name: 'Bob Ray', role: 'inspector' },
            { email: 'cara@example.test', name: 'Cara Lin', role: 'inspector' },
            { email: 'dan@example.test', name: 'Dan Roe', role: 'inspector' },
        ];

        for (let i = 0; i < fixes.length; i++) {
            const res = await intakeRequest(
                opts,
                `/api/imports/${batchId}/rows/${before.problemRows[i].rowId}`,
                jsonBody({ payload: fixes[i] }, 'PATCH'),
            );
            expect(res.status).toBe(200);
            expect((await res.json() as { data: { resolved: boolean } }).data.resolved).toBe(true);

            // One fewer each time. A single read at the end could not tell a
            // repair that worked from one that happened to be unnecessary.
            const mid = await report(batchId);
            expectBucketsClose(mid, 5, fixes.length - 1 - i);
        }

        const after = await report(batchId);
        expect(after.counts).toEqual({ total: 5, ok: 5, conflicts: 0, problems: 0 });
        expect(after.blockedReason).toBeNull();

        // The repaired run really does invite everybody, so "no problems left"
        // is not a report that merely stopped complaining.
        const applied = await intakeRequest(
            opts, `/api/imports/${batchId}/apply`, jsonBody({ conflictPolicy: 'skip' }),
        );
        expect(applied.status).toBe(200);
        expect((await applied.json() as { data: { applied: number; failed: number } }).data)
            .toMatchObject({ applied: 5, failed: 0 });
        expect((await db.select().from(schema.tenantInvites).all()).map((i) => i.email).sort())
            .toEqual([
                'alice@example.test', 'bob@example.test', 'cara@example.test',
                'dan@example.test', 'eve@example.test',
            ]);
    });

    it('a contact with no address at all is not a problem, and imports', async () => {
        const batchId = await upload('contacts.import', CONTACTS_CSV);
        const r = await report(batchId);
        expectBucketsClose(r, 2, 0);
        expect(r.blockedReason).toBeNull();

        const applied = await intakeRequest(
            opts, `/api/imports/${batchId}/apply`, jsonBody({ conflictPolicy: 'skip' }),
        );
        expect(applied.status).toBe(200);
        const rows = await db.select().from(schema.contacts).all();
        expect(rows.map((c) => c.name).sort()).toEqual(['Alice Ng', 'Bob Ray']);
        // Stored as absent rather than as an empty string, so two address-less
        // contacts cannot collide on the active-contact unique index.
        expect(rows.find((c) => c.name === 'Bob Ray')?.email).toBeNull();
    });
});
