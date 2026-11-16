/**
 * The data package job table: one active job per company enforced by the database, bounded text columns,
 * fixed vocabularies, and removal with the company.
 *
 * Runs against the real migrations (replayed into an in-memory database), so the partial unique index and
 * the CHECK constraints under test are the ones that ship, not a copy.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { and, eq, getTableName } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { DATA_JOB_TEXT_MAX_CHARS, DATA_JOB_STATUSES, DATA_JOB_STAGES } from '../../../server/lib/db/schema';
import { tenantScopedTables } from '../../../server/lib/db/scoped-tables';
import { TenantPurgeService } from '../../../server/services/tenant-purge.service';
import { lazyD1 } from '../helpers/d1-binding';

const TENANT_A = '00000000-0000-0000-0000-00000000000a';
const TENANT_B = '00000000-0000-0000-0000-00000000000b';
type Status = schema.TenantDataJob['status'];
const NOW = new Date('2026-11-10T12:00:00Z');
let seq = 0;

function job(tenantId: string, status: Status, over: Partial<schema.NewTenantDataJob> = {}): schema.NewTenantDataJob {
    return {
        id: `job-${++seq}`, tenantId, kind: 'export', status, stage: 'rows', createdBy: 'user-1',
        createdAt: NOW, updatedAt: NOW, ...over,
    };
}

describe('tenant_data_jobs', () => {
    let db: BetterSQLite3Database<typeof schema>;
    beforeEach(() => { db = createTestDb().db; });

    it('refuses a second active job for the same company, whichever active state either is in', async () => {
        await db.insert(schema.tenantDataJobs).values(job(TENANT_A, 'queued'));
        await expect(db.insert(schema.tenantDataJobs).values(job(TENANT_A, 'queued'))).rejects.toThrow(/UNIQUE/i);
        await expect(db.insert(schema.tenantDataJobs).values(job(TENANT_A, 'running', { kind: 'import', stage: 'upload' }))).rejects.toThrow(/UNIQUE/i);
        const rows = await db.select().from(schema.tenantDataJobs).where(eq(schema.tenantDataJobs.tenantId, TENANT_A)).all();
        expect(rows).toHaveLength(1);
    });

    it('does not let one company\'s active job block another company', async () => {
        await db.insert(schema.tenantDataJobs).values(job(TENANT_A, 'running'));
        await db.insert(schema.tenantDataJobs).values(job(TENANT_B, 'running'));
        expect(await db.select().from(schema.tenantDataJobs).all()).toHaveLength(2);
    });

    it.each(['complete', 'failed', 'cancelled', 'expired'] as const)('a %s job does not hold the slot, and any number may exist', async (status) => {
        await db.insert(schema.tenantDataJobs).values(job(TENANT_A, status));
        await db.insert(schema.tenantDataJobs).values(job(TENANT_A, status));
        await db.insert(schema.tenantDataJobs).values(job(TENANT_A, 'queued'));
        await expect(db.insert(schema.tenantDataJobs).values(job(TENANT_A, 'queued'))).rejects.toThrow(/UNIQUE/i);
    });

    it('frees the slot when the active job reaches a terminal state, and takes it again after', async () => {
        const first = job(TENANT_A, 'running');
        await db.insert(schema.tenantDataJobs).values(first);
        await db.update(schema.tenantDataJobs).set({ status: 'complete', finishedAt: NOW })
            .where(and(eq(schema.tenantDataJobs.id, first.id!), eq(schema.tenantDataJobs.tenantId, TENANT_A)));
        await db.insert(schema.tenantDataJobs).values(job(TENANT_A, 'queued'));
        await expect(db.insert(schema.tenantDataJobs).values(job(TENANT_A, 'running'))).rejects.toThrow(/UNIQUE/i);
    });

    it('accepts a cursor and a counts text at the cap and refuses one character over', async () => {
        const atCap = 'x'.repeat(DATA_JOB_TEXT_MAX_CHARS);
        await db.insert(schema.tenantDataJobs).values(job(TENANT_A, 'complete', { cursor: atCap, counts: atCap }));
        await expect(db.insert(schema.tenantDataJobs).values(job(TENANT_A, 'complete', { cursor: atCap + 'x' }))).rejects.toThrow(/CHECK/i);
        await expect(db.insert(schema.tenantDataJobs).values(job(TENANT_A, 'complete', { counts: atCap + 'x' }))).rejects.toThrow(/CHECK/i);
        const [ok] = await db.select({ n: schema.tenantDataJobs.cursor }).from(schema.tenantDataJobs).all();
        expect(ok?.n?.length).toBe(DATA_JOB_TEXT_MAX_CHARS);
    });

    it('refuses to grow an existing cursor past the cap', async () => {
        const row = job(TENANT_A, 'running', { cursor: '{"t":"a"}' });
        await db.insert(schema.tenantDataJobs).values(row);
        await expect(db.update(schema.tenantDataJobs).set({ cursor: 'y'.repeat(DATA_JOB_TEXT_MAX_CHARS + 1) })
            .where(eq(schema.tenantDataJobs.id, row.id!))).rejects.toThrow(/CHECK/i);
    });

    it('declares the fixed state vocabulary, with exactly queued and running as the active ones', () => {
        expect([...DATA_JOB_STATUSES]).toEqual(['queued', 'running', 'complete', 'failed', 'cancelled', 'expired']);
        // The vocabulary is a type-layer enum on the column, so a status outside it does not compile; this pins the list itself.
        // @ts-expect-error 'paused' is not a job status
        const bad: Status = 'paused';
        expect(bad).toBe('paused');
    });

    it('declares the seven client-reported stages', () => {
        expect([...DATA_JOB_STAGES]).toEqual(['rows', 'media', 'finish', 'upload', 'preview', 'apply', 'revert']);
    });

    it('stores the lease fields and reads them back scoped by tenant', async () => {
        const leaseExpiresAt = new Date('2026-11-16T12:05:00Z');
        await db.insert(schema.tenantDataJobs).values(job(TENANT_A, 'running', {
            leaseHolder: 'laptop-A47', clientKind: 'desktop-windows', leaseExpiresAt,
        }));
        const [row] = await db.select().from(schema.tenantDataJobs)
            .where(eq(schema.tenantDataJobs.tenantId, TENANT_A)).all();
        expect(row?.leaseHolder).toBe('laptop-A47');
        expect(row?.clientKind).toBe('desktop-windows');
        expect(row?.leaseExpiresAt?.toISOString()).toBe('2026-11-16T12:05:00.000Z');
        // The old package-expiry column is gone; the lease expiry replaced it.
        expect(row).not.toHaveProperty('expiresAt');
    });

    it('is covered by the tenant purge set and deleted with the company, leaving other companies\' jobs', async () => {
        expect(tenantScopedTables().map(getTableName)).toContain('tenant_data_jobs');

        const fix = createTestDb();
        const testD1 = lazyD1();
        testD1.use(fix.db);
        await fix.db.insert(schema.tenants).values({ id: TENANT_A, slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: NOW });
        await fix.db.insert(schema.tenantDataJobs).values([job(TENANT_A, 'running'), job(TENANT_A, 'complete'), job(TENANT_B, 'running')]);

        const r2 = { list: async () => ({ objects: [], truncated: false }), delete: async () => undefined } as unknown as R2Bucket;
        const kv = { delete: async () => undefined, list: async () => ({ keys: [], list_complete: true }) } as unknown as KVNamespace;
        await new TenantPurgeService(testD1.binding, r2, kv).purge(TENANT_A);

        const left = await fix.db.select().from(schema.tenantDataJobs).all();
        expect(left.map((r) => r.tenantId)).toEqual([TENANT_B]);
    });
});
