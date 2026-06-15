/**
 * TenantPurgeService — offboarding purge + destruction record (Privacy P3 §3.2).
 *
 * The purge cascade-deletes all tenant rows, R2 objects and KV keys, then writes
 * a DURABLE non-personal destruction record. The record must survive the purge:
 * `tenant_destruction_records` is a platform-level table (no tenant FK, never in
 * TENANT_TABLES), so it is the compliance proof that outlives the tenant.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TenantPurgeService } from '../../server/services/tenant-purge.service';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

const TENANT = '00000000-0000-0000-0000-000000000001';

function makeR2(objects: { key: string; size: number }[]) {
    const deleted: string[] = [];
    return {
        bucket: {
            list: vi.fn(async () => ({ objects, truncated: false, cursor: undefined })),
            delete: vi.fn(async (keys: string[]) => { deleted.push(...keys); }),
        } as unknown as R2Bucket,
        deleted,
    };
}

function makeKv() {
    const deleted: string[] = [];
    return {
        ns: {
            delete: vi.fn(async (k: string) => { deleted.push(k); }),
        } as unknown as KVNamespace,
        deleted,
    };
}

describe('TenantPurgeService.purge', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        sqlite = fix.sqlite;
        await setupSchema(fix.sqlite);
        await testDb.insert(schema.tenants).values({
            id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await testDb.insert(schema.users).values({
            id: 'u-1', tenantId: TENANT, email: 'a@x.com', passwordHash: 'x', role: 'admin', createdAt: new Date(),
        });
        await testDb.insert(schema.inspections).values({
            id: 'i-1', tenantId: TENANT, propertyAddress: '1 St', date: '2026-06-01',
            status: 'requested', paymentStatus: 'unpaid', price: 0,
            agreementRequired: false, paymentRequired: false, createdAt: new Date(),
        });
    });

    it('deletes tenant rows and returns counts', async () => {
        const { drizzle } = await import('drizzle-orm/d1');
        (drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        const r2 = makeR2([{ key: `tenants/${TENANT}/p1.jpg`, size: 100 }]);
        const kv = makeKv();
        const svc = new TenantPurgeService({} as D1Database, r2.bucket, kv.ns);

        const result = await svc.purge(TENANT);

        expect(result.rows).toBeGreaterThan(0);
        expect(result.r2).toBe(1);
        // tenant + child rows gone
        const remaining = await testDb.select().from(schema.tenants).all();
        expect(remaining).toHaveLength(0);
    });

    it('writes a durable destruction record that survives the purge', async () => {
        const { drizzle } = await import('drizzle-orm/d1');
        (drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        const r2 = makeR2([
            { key: `tenants/${TENANT}/p1.jpg`, size: 100 },
            { key: `tenants/${TENANT}/p2.jpg`, size: 250 },
        ]);
        const kv = makeKv();
        const svc = new TenantPurgeService({} as D1Database, r2.bucket, kv.ns);

        await svc.purge(TENANT);

        const records = await testDb.select().from(schema.tenantDestructionRecords).all();
        expect(records).toHaveLength(1);
        const rec = records[0]!;
        expect(rec.tenantId).toBe(TENANT);
        expect(rec.tenantSlug).toBe('acme');
        expect(rec.r2Objects).toBe(2);
        expect(rec.r2Bytes).toBe(350);
        expect(rec.rowsDeleted).toBeGreaterThan(0);
        expect(rec.destroyedAt).toBeInstanceOf(Date);
    });

    it('cascades agreement_signers (PII) so no orphaned signer rows survive', async () => {
        const { drizzle } = await import('drizzle-orm/d1');
        (drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        // Seed an agreement template + envelope + signer (PII) under the tenant.
        await testDb.insert(schema.agreements).values({
            id: 'agr-1', tenantId: TENANT, name: 'Std', content: 'text', version: 1, createdAt: new Date(),
        } as never);
        await testDb.insert(schema.agreementRequests).values({
            id: 'req-1', tenantId: TENANT, inspectionId: 'i-1', agreementId: 'agr-1',
            clientEmail: 'jane@test.com', clientName: 'Jane', token: crypto.randomUUID(),
            status: 'sent', completionPolicy: 'all', createdAt: new Date(),
        } as never);
        await testDb.insert(schema.agreementSigners).values({
            id: 'sig-1', tenantId: TENANT, requestId: 'req-1', name: 'Jane', email: 'jane@test.com',
            role: 'client', tokenHash: null, tokenEnc: null, status: 'sent', createdAt: new Date(),
        } as never);

        const r2 = makeR2([]);
        const kv = makeKv();
        const svc = new TenantPurgeService({} as D1Database, r2.bucket, kv.ns);
        await svc.purge(TENANT);

        const signers = await testDb.select().from(schema.agreementSigners).all();
        expect(signers).toHaveLength(0);
    });

    it('erasure_log rows for the tenant are deleted on whole-tenant purge', async () => {
        const { drizzle } = await import('drizzle-orm/d1');
        (drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        // Seed an erasure_log row scoped to the tenant (subject_email is PII).
        await testDb.insert(schema.erasureLog).values({
            id: 'elog-1',
            tenantId: TENANT,
            subjectEmail: 'subject@privacy.com',
            requestedBy: 'admin-sub',
            identityBasis: 'admin_action',
            status: 'completed',
            decisionsJson: '[]',
            retainedCount: 0,
            anonymizedCount: 0,
            deletedCount: 0,
            createdAt: Date.now(),
        });

        const r2 = makeR2([]);
        const kv = makeKv();
        const svc = new TenantPurgeService({} as D1Database, r2.bucket, kv.ns);
        await svc.purge(TENANT);

        const remaining = await testDb.select().from(schema.erasureLog).all();
        expect(remaining).toHaveLength(0);
    });

    it('destruction record is non-personal (no email/name/address columns)', async () => {
        const { drizzle } = await import('drizzle-orm/d1');
        (drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        const r2 = makeR2([]);
        const kv = makeKv();
        const svc = new TenantPurgeService({} as D1Database, r2.bucket, kv.ns);
        await svc.purge(TENANT);

        const cols = sqlite.prepare(`PRAGMA table_info('tenant_destruction_records')`).all() as { name: string }[];
        const names = cols.map(c => c.name);
        expect(names).not.toContain('email');
        expect(names).not.toContain('name');
        expect(names).not.toContain('property_address');
    });
});
