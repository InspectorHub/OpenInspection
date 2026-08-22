/**
 * The `statutory_form_versions` row, and the two nullable columns that carry
 * meaning by being null.
 *
 * `mandatory_from` null means "published, never mandated" and `effective_until`
 * null means "still usable". Both are read by `versionForInspection`, so a
 * column that silently defaulted to a date — or one that could not hold null at
 * all — would change which statutory document gets rendered. These assertions
 * pin the storage layer to what the selection logic assumes.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

const row = (over: Partial<typeof schema.statutoryFormVersions.$inferInsert> = {}) => ({
    id: 'sfv-1',
    formId: 'tx_trec_rei',
    version: '7-6',
    effectiveFrom: new Date('2021-09-01T00:00:00.000Z'),
    sourceUrl: 'https://example.gov/forms/rei.pdf',
    sourceHash: HASH_A,
    objectKey: 'statutory/tx_trec_rei/7-6.pdf',
    publishedBy: 'u1',
    publishedAt: new Date('2026-08-21T00:00:00.000Z'),
    ...over,
});

describe('statutory_form_versions', () => {
    let db: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        await setupSchema(fix.sqlite);
    });

    it('keeps mandatory_from and effective_until NULL when nothing set them', async () => {
        await db.insert(schema.statutoryFormVersions).values(row());
        const stored = await db.select().from(schema.statutoryFormVersions)
            .where(eq(schema.statutoryFormVersions.id, 'sfv-1')).get();
        expect(stored?.mandatoryFrom).toBeNull();
        expect(stored?.effectiveUntil).toBeNull();
    });

    it('POSITIVE CONTROL — the same columns round-trip a real date', async () => {
        // Without this, the assertion above also passes for a column that can
        // hold nothing but null.
        await db.insert(schema.statutoryFormVersions).values(row({
            mandatoryFrom: new Date('2022-02-01T00:00:00.000Z'),
            effectiveUntil: new Date('2030-01-01T00:00:00.000Z'),
        }));
        const stored = await db.select().from(schema.statutoryFormVersions)
            .where(eq(schema.statutoryFormVersions.id, 'sfv-1')).get();
        expect(stored?.mandatoryFrom?.toISOString()).toBe('2022-02-01T00:00:00.000Z');
        expect(stored?.effectiveUntil?.toISOString()).toBe('2030-01-01T00:00:00.000Z');
    });

    it('refuses a second row for the same (form, revision)', async () => {
        // Two rows for one revision leaves "which bytes are this revision"
        // unanswerable, and the two hashes below are what makes that concrete.
        await db.insert(schema.statutoryFormVersions).values(row());
        await expect(
            db.insert(schema.statutoryFormVersions).values(row({ id: 'sfv-2', sourceHash: HASH_B })),
        ).rejects.toThrow(/UNIQUE/i);
    });

    it('POSITIVE CONTROL — a DIFFERENT revision of the same form is accepted', async () => {
        // Otherwise the constraint above could be one on `form_id` alone, which
        // would make a form permanently single-revision.
        await db.insert(schema.statutoryFormVersions).values(row());
        await db.insert(schema.statutoryFormVersions).values(
            row({ id: 'sfv-2', version: '7-5', sourceHash: HASH_B }),
        );
        const all = await db.select().from(schema.statutoryFormVersions).all();
        expect(all.map((r) => r.version).sort()).toEqual(['7-5', '7-6']);
    });
});
