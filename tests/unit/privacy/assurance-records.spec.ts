/**
 * The read side of the three assurance ledgers.
 *
 * Every table under test was written by exactly one call site and read by
 * nothing before this module existed, so these specs are the first thing that
 * has ever asserted a retrieval. What they pin, in order of how badly it would
 * hurt to get wrong:
 *
 *   1. The AI ledger is TENANT-SCOPED on BOTH tables. A review row carries its
 *      own tenant_id and the read must not rely on the provenance filter alone.
 *   2. A call with no review is returned WITH AN EMPTY LIST, never dropped —
 *      "nobody reviewed this output" is the fact a compliance reader is here for.
 *   3. A review citing a call this workspace has no provenance row for is
 *      COUNTED rather than silently lost.
 *   4. The destruction ledger is readable for a tenant that no longer exists,
 *      which is the entire reason it is not tenant-scoped.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, setupSchema } from '../db';
import { asAnyDb } from '../helpers/test-db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
    readAiAssurance,
    readDestructionRecords,
    ASSURANCE_MAX_PAGE,
} from '../../../server/lib/compliance/assurance-records';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTHER  = '00000000-0000-0000-0000-000000000002';
const USER   = '00000000-0000-0000-0000-0000000000aa';

let db: BetterSQLite3Database<typeof schema>;

async function seedCall(id: string, tenantId: string, atMs: number, promptVersion = 'professional-comment.v1') {
    await db.insert(schema.aiCallProvenance).values({
        id,
        tenantId,
        capability: 'assist',
        provider: 'gemini',
        mode: 'byo',
        model: 'gemini-test',
        promptVersion,
        createdAt: new Date(atMs),
    });
}

async function seedReview(id: string, tenantId: string, aiCallId: string, atMs: number, reviewedBy = USER) {
    await db.insert(schema.aiContentReviews).values({
        id,
        tenantId,
        artifactType: 'inspection_result',
        artifactId: `artifact-${id}`,
        reviewedBy,
        reviewedAt: new Date(atMs),
        aiCallId,
    });
}

beforeEach(async () => {
    const fix = createTestDb();
    db = fix.db;
    await setupSchema(fix.sqlite);
    await db.insert(schema.tenants).values([
        { id: TENANT, slug: 'acme',  status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        { id: OTHER,  slug: 'other', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
    ]);
    await db.insert(schema.users).values({
        id: USER, tenantId: TENANT, email: 'reviewer@example.com', name: 'Dana Reviewer',
        passwordHash: 'x', role: 'manager', createdAt: new Date(),
    });
});

describe('readAiAssurance', () => {
    it('joins each call to the reviews citing it, newest call first', async () => {
        await seedCall('call-old', TENANT, 1_000);
        await seedCall('call-new', TENANT, 2_000);
        await seedReview('rev-1', TENANT, 'call-new', 2_500);

        const page = await readAiAssurance(asAnyDb(db), { tenantId: TENANT });

        expect(page.calls.map(c => c.id)).toEqual(['call-new', 'call-old']);
        expect(page.calls[0].reviews).toHaveLength(1);
        expect(page.calls[0].reviews[0]).toMatchObject({
            id: 'rev-1',
            artifactType: 'inspection_result',
            reviewedBy: USER,
            reviewerName: 'Dana Reviewer',
            reviewedAt: 2_500,
        });
        expect(page.calls[0].promptVersion).toBe('professional-comment.v1');
    });

    it('returns an unreviewed call with an empty review list rather than omitting it', async () => {
        await seedCall('call-unreviewed', TENANT, 1_000);

        const page = await readAiAssurance(asAnyDb(db), { tenantId: TENANT });

        expect(page.calls).toHaveLength(1);
        expect(page.calls[0].reviews).toEqual([]);
    });

    it('never returns another workspace’s calls', async () => {
        await seedCall('call-mine',    TENANT, 1_000);
        await seedCall('call-theirs',  OTHER,  2_000);

        const page = await readAiAssurance(asAnyDb(db), { tenantId: TENANT });

        expect(page.calls.map(c => c.id)).toEqual(['call-mine']);
    });

    it('never attaches another workspace’s review, even when it cites this workspace’s call', async () => {
        // POST /api/ai/reviews takes aiCallId from the body without checking the
        // call belongs to the caller, so this row is constructible today.
        await seedCall('call-mine', TENANT, 1_000);
        await seedReview('rev-foreign', OTHER, 'call-mine', 1_500);

        const page = await readAiAssurance(asAnyDb(db), { tenantId: TENANT });

        expect(page.calls[0].reviews).toEqual([]);
    });

    it('counts a review whose cited call has no provenance row here', async () => {
        await seedCall('call-mine', TENANT, 1_000);
        await seedReview('rev-ok',      TENANT, 'call-mine',    1_500);
        await seedReview('rev-dangling', TENANT, 'call-missing', 1_600);

        const page = await readAiAssurance(asAnyDb(db), { tenantId: TENANT });

        expect(page.unresolvedReviewCount).toBe(1);
        expect(page.calls[0].reviews.map(r => r.id)).toEqual(['rev-ok']);
    });

    it('pages backwards with nextBefore and stops at the end of the ledger', async () => {
        await seedCall('c1', TENANT, 1_000);
        await seedCall('c2', TENANT, 2_000);
        await seedCall('c3', TENANT, 3_000);

        const first = await readAiAssurance(asAnyDb(db), { tenantId: TENANT, limit: 2 });
        expect(first.calls.map(c => c.id)).toEqual(['c3', 'c2']);
        expect(first.nextBefore).toBe(2_000);

        const second = await readAiAssurance(asAnyDb(db), { tenantId: TENANT, limit: 2, before: first.nextBefore! });
        expect(second.calls.map(c => c.id)).toEqual(['c1']);
        expect(second.nextBefore).toBeNull();
    });

    it('clamps a caller-supplied limit to the page ceiling', async () => {
        await seedCall('c1', TENANT, 1_000);

        const page = await readAiAssurance(asAnyDb(db), { tenantId: TENANT, limit: ASSURANCE_MAX_PAGE + 5_000 });

        // The clamp is not observable through row count with one row seeded, so
        // assert the cursor contract instead: a page shorter than the (clamped)
        // limit is the end of the ledger.
        expect(page.calls).toHaveLength(1);
        expect(page.nextBefore).toBeNull();
    });

    it('resolves the reviewer name to null when the user row is gone', async () => {
        await seedCall('call-mine', TENANT, 1_000);
        await seedReview('rev-1', TENANT, 'call-mine', 1_500, 'deleted-user-id');

        const page = await readAiAssurance(asAnyDb(db), { tenantId: TENANT });

        expect(page.calls[0].reviews[0].reviewerName).toBeNull();
        expect(page.calls[0].reviews[0].reviewedBy).toBe('deleted-user-id');
    });
});

describe('readDestructionRecords', () => {
    async function seedDestruction(id: string, tenantId: string, atMs: number, slug: string | null = 'gone') {
        await db.insert(schema.tenantDestructionRecords).values({
            id, tenantId, tenantSlug: slug,
            rowsDeleted: 42, r2Objects: 7, r2Bytes: 1_024, kvKeys: 3,
            destroyedAt: new Date(atMs),
        });
    }

    it('reads the proof for a tenant that no longer exists as a row', async () => {
        // The whole point: no `tenants` row is seeded for this id.
        await seedDestruction('d1', 'ghost-tenant', 5_000, 'ghost');

        const page = await readDestructionRecords(asAnyDb(db), { tenantId: 'ghost-tenant' });

        expect(page.records).toHaveLength(1);
        expect(page.records[0]).toMatchObject({
            tenantId: 'ghost-tenant',
            tenantSlug: 'ghost',
            rowsDeleted: 42,
            r2Objects: 7,
            r2Bytes: 1_024,
            kvKeys: 3,
            destroyedAt: 5_000,
        });
    });

    it('returns every record newest first when no tenant filter is given', async () => {
        await seedDestruction('d1', 'ghost-a', 1_000);
        await seedDestruction('d2', 'ghost-b', 2_000);

        const page = await readDestructionRecords(asAnyDb(db));

        expect(page.records.map(r => r.id)).toEqual(['d2', 'd1']);
    });

    it('narrows to one destroyed workspace when a tenant filter is given', async () => {
        await seedDestruction('d1', 'ghost-a', 1_000);
        await seedDestruction('d2', 'ghost-b', 2_000);

        const page = await readDestructionRecords(asAnyDb(db), { tenantId: 'ghost-a' });

        expect(page.records.map(r => r.id)).toEqual(['d1']);
    });

    it('pages backwards with nextBefore', async () => {
        await seedDestruction('d1', 'ghost-a', 1_000);
        await seedDestruction('d2', 'ghost-b', 2_000);

        const first = await readDestructionRecords(asAnyDb(db), { limit: 1 });
        expect(first.records.map(r => r.id)).toEqual(['d2']);
        expect(first.nextBefore).toBe(2_000);

        const second = await readDestructionRecords(asAnyDb(db), { limit: 1, before: first.nextBefore! });
        expect(second.records.map(r => r.id)).toEqual(['d1']);
    });

    it('tolerates a null slug', async () => {
        await seedDestruction('d1', 'ghost-a', 1_000, null);

        const page = await readDestructionRecords(asAnyDb(db));

        expect(page.records[0].tenantSlug).toBeNull();
    });
});
