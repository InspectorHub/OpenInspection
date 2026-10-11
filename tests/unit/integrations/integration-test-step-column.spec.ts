/**
 * The `step` column: schema position, migration, and that recordIntegrationTest
 * writes it. The prune rule is unchanged (still per tenant + target).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { integrationTestResults } from '../../../server/lib/db/schema';
import { recordIntegrationTest, idsToPrune, KEEP_PER_TARGET } from '../../../server/lib/integration-test-results';

describe('integration_test_results.step', () => {
    it('is a nullable text column appended last', () => {
        const cols = getTableConfig(integrationTestResults).columns;
        const last = cols[cols.length - 1]!;
        expect(last.name).toBe('step');
        expect(last.notNull).toBe(false);
        expect(last.getSQLType()).toBe('text');
    });

    it('has a forward migration that adds exactly that column', () => {
        // migrefs-allow: the test pins the exact SQL of the migration that adds the column
        const sql = readFileSync('migrations/0001_integration_test_step.sql', 'utf8');
        expect(sql.trim()).toBe('ALTER TABLE `integration_test_results` ADD `step` text;');
    });

    it('recordIntegrationTest persists the step, and null when none is given', async () => {
        const inserted: Array<Record<string, unknown>> = [];
        const db = {
            insert: () => ({ values: async (v: Record<string, unknown>) => { inserted.push(v); } }),
            select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ all: async () => [] }) }) }) }),
        };
        const base = { tenantId: 't1', target: 'email' as const, ok: true, detail: 'ok' };
        await recordIntegrationTest(db as never, { ...base, step: 'send_test' });
        await recordIntegrationTest(db as never, base);
        expect(inserted.map((r) => r.step)).toEqual(['send_test', null]);
    });

    it('keeps the cap at 5, applied per (target, step)', () => {
        expect(KEEP_PER_TARGET).toBe(5);
        expect(idsToPrune(['a', 'b', 'c', 'd', 'e', 'f'], KEEP_PER_TARGET)).toEqual(['f']);
    });
});
