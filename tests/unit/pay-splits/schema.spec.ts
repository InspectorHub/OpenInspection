/**
 * Pay-split schema, asserted at the DB level (#278).
 *
 * These are not "does drizzle work" tests. Each one pins a constraint that the
 * money design depends on and that nothing else in the codebase would notice
 * losing:
 *
 *   - exactly ONE default rule per service (SQLite treats NULLs as distinct, so
 *     the obvious three-column unique silently allows two, and the populate
 *     step would then pick one arbitrarily);
 *   - exactly ONE primary split per (line, user), while still allowing the
 *     correction rows a locked split requires.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { servicePayRules, inspectionServicePaySplits } from '../../../server/lib/db/schema/pay-split';
import { createTestDb, setupSchema } from '../db';

const T = Date.now();

describe('pay-split schema', () => {
    let sqlite: import('better-sqlite3').Database;

    beforeEach(async () => {
        const fixture = createTestDb();
        sqlite = fixture.sqlite;
        await setupSchema(fixture.sqlite);
    });

    const insertRule = (id: string, userId: string | null) =>
        sqlite.prepare(
            `INSERT INTO service_pay_rules (id, tenant_id, service_id, user_id, type, value, created_at)
             VALUES (?,?,?,?,?,?,?)`,
        ).run(id, 't1', 'svc1', userId, 'percent', 6000, T);

    const insertSplit = (id: string, userId: string, corrects: string | null) =>
        sqlite.prepare(
            `INSERT INTO inspection_service_pay_splits
                (id, tenant_id, inspection_service_id, user_id, amount_cents, source, corrects_split_id, created_at, updated_at)
             VALUES (?,?,?,?,?,?,?,?,?)`,
        ).run(id, 't1', 'line1', userId, 9000, 'rule', corrects, T, T);

    it('stores money in integer cents and timestamps in epoch ms', () => {
        const cols = inspectionServicePaySplits as unknown as Record<string, { name: string }>;
        expect(cols.amountCents.name).toBe('amount_cents');
        expect(cols.createdAt.name).toBe('created_at');
        expect(cols.lockedAt.name).toBe('locked_at');
        const ddl = sqlite.prepare(
            `SELECT sql FROM sqlite_master WHERE name = 'inspection_service_pay_splits'`,
        ).get() as { sql: string };
        expect(ddl.sql).toMatch(/`amount_cents`\s+integer\s+NOT NULL/i);
        expect(ddl.sql).toMatch(/`created_at`\s+integer\s+NOT NULL/i);
    });

    it('carries tenant_id NOT NULL and declares no foreign keys', () => {
        // Schema Rules: new tables are tenant-scoped and app-layer-integrity
        // only. A DB-level FK here would make the table impossible to rebuild
        // on D1 for the rest of its life.
        for (const table of ['service_pay_rules', 'inspection_service_pay_splits']) {
            const ddl = (sqlite.prepare(
                `SELECT sql FROM sqlite_master WHERE name = ?`,
            ).get(table) as { sql: string }).sql;
            expect(ddl, table).toMatch(/`tenant_id`\s+text\s+NOT NULL/i);
            expect(ddl, table).not.toMatch(/REFERENCES/i);
        }
    });

    it('allows exactly one DEFAULT rule per service', () => {
        // The load-bearing one. A plain unique over (tenant, service, user)
        // does NOT catch this — SQLite considers two NULL user_ids distinct.
        insertRule('r1', null);
        expect(() => insertRule('r2', null)).toThrow(/UNIQUE constraint/);
    });

    it('still allows a per-inspector rule alongside the default', () => {
        insertRule('r1', null);
        expect(() => insertRule('r2', 'u1')).not.toThrow();
        expect(() => insertRule('r3', 'u1')).toThrow(/UNIQUE constraint/);
        const t = servicePayRules as unknown as Record<string, { name: string }>;
        expect(t.deductionCents.name).toBe('deduction_cents');
    });

    it('allows exactly one PRIMARY split per line and user', () => {
        insertSplit('s1', 'u1', null);
        expect(() => insertSplit('s2', 'u1', null)).toThrow(/UNIQUE constraint/);
    });

    it('allows correction rows against a split without tripping that unique', () => {
        // A locked split is never edited; a correction is a new row. If the
        // unique index were unconditional, that path could not be written.
        insertSplit('s1', 'u1', null);
        expect(() => insertSplit('s2', 'u1', 's1')).not.toThrow();
        expect(() => insertSplit('s3', 'u1', 's1')).not.toThrow();
    });
});
