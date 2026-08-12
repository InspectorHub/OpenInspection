/**
 * A review may only cite a call this workspace made.
 *
 * `recordContentReview` takes `tenantId` from the verified session and
 * `aiCallId` from the request body. Until this check existed it wrote the pair
 * without asking whether they belonged together, so any authenticated user
 * could file a review naming another tenant's call — a row asserting provenance
 * it did not have, and one workspace's identifier landing in another's audit
 * ledger. The reader (`readAiAssurance`) counts such rows as orphans, which is
 * the right thing to do with rows that already exist and the wrong thing to
 * rely on for rows still being written.
 *
 * The reviewer-identity half of this seam is asserted in the route: `reviewedBy`
 * comes from the session and is never read from the body. The call-ownership
 * half lives here, in the function, because that is where every caller meets it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { recordContentReview } from '../../../server/lib/ai/content-review';

const MINE   = '00000000-0000-0000-0000-0000000000m1';
const THEIRS = '00000000-0000-0000-0000-0000000000t1';
const USER   = 'user-a';

let db: BetterSQLite3Database<typeof schema>;

/** Bare enough to be a valid row; the fields under test are id + tenant. */
async function seedCall(id: string, tenantId: string) {
    await db.insert(schema.aiCallProvenance).values({
        id, tenantId,
        capability: 'assist', provider: 'gemini', mode: 'byo',
        model: 'gemini-test', promptVersion: 'test.v1',
        createdAt: new Date(1_700_000_000_000),
    });
}

const reviews = () => db.select().from(schema.aiContentReviews).all();

const record = (tenantId: string, aiCallId: string) => recordContentReview({
    db: {} as D1Database,
    tenantId,
    artifactType: 'inspection_result',
    artifactId: 'artifact-1',
    reviewedBy: USER,
    aiCallId,
});

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db;
    await setupSchema(fx.sqlite);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockDrizzle as any).mockReturnValue(db);
});

describe('recordContentReview — the call must belong to the workspace', () => {
    it('records a review of a call this workspace made', async () => {
        // The positive control. Without it, every assertion below would pass on
        // a function that rejects unconditionally.
        await seedCall('call-mine', MINE);

        await record(MINE, 'call-mine');

        const rows = await reviews();
        expect(rows).toHaveLength(1);
        expect(rows[0]!.aiCallId).toBe('call-mine');
        expect(rows[0]!.tenantId).toBe(MINE);
    });

    it('refuses a review citing another workspace\'s call, and writes nothing', async () => {
        await seedCall('call-theirs', THEIRS);

        await expect(record(MINE, 'call-theirs')).rejects.toThrow(/No AI call to review/);

        // The refusal has to be a refusal, not a 500 after the insert landed.
        expect(await reviews()).toHaveLength(0);
    });

    it('refuses a call id that exists nowhere, with the same answer', async () => {
        // Deliberately indistinguishable from the case above: a different
        // message would confirm the existence of an id the caller is not
        // entitled to know about.
        await expect(record(MINE, 'call-nowhere')).rejects.toThrow(/No AI call to review/);
        expect(await reviews()).toHaveLength(0);
    });

    it('leaves the other workspace\'s ledger untouched', async () => {
        await seedCall('call-theirs', THEIRS);

        await expect(record(MINE, 'call-theirs')).rejects.toThrow();

        const theirs = await db.select().from(schema.aiContentReviews)
            .where(eq(schema.aiContentReviews.tenantId, THEIRS)).all();
        expect(theirs).toHaveLength(0);
    });

    it('still treats a repeated review of an owned call as a no-op', async () => {
        // The check is a read before an insert, and the note on the function
        // warns against exactly that shape — for duplicates. This pins that the
        // idempotency it was protecting is intact: same person, same call, twice.
        await seedCall('call-mine', MINE);

        await record(MINE, 'call-mine');
        await record(MINE, 'call-mine');

        expect(await reviews()).toHaveLength(1);
    });
});
