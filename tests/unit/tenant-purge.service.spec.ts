/**
 * TenantPurgeService — offboarding purge + destruction record (Privacy P3 §3.2).
 *
 * The purge cascade-deletes all tenant rows, R2 objects and KV keys, then writes
 * a DURABLE non-personal destruction record. The record must survive the purge:
 * `tenant_destruction_records` is a platform-level table (no tenant FK, never in
 * TENANT_TABLES), so it is the compliance proof that outlives the tenant.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TenantPurgeService, tenantScopedTables } from '../../server/services/tenant-purge.service';
import { getTableName } from 'drizzle-orm';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

const TENANT = '00000000-0000-0000-0000-000000000001';

function makeR2(objects: { key: string; size: number }[]) {
    const deleted: string[] = [];
    return {
        bucket: {
            // Prefix-aware so the purge can sweep multiple prefixes (e.g. the
            // `tenants/` photo tree AND the `uploads/` client-document tree).
            list: vi.fn(async (opts?: { prefix?: string }) => ({
                objects: opts?.prefix ? objects.filter(o => o.key.startsWith(opts.prefix!)) : objects,
                truncated: false,
                cursor: undefined,
            })),
            delete: vi.fn(async (keys: string[] | string) => {
                deleted.push(...(Array.isArray(keys) ? keys : [keys]));
            }),
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

    it('purges client_uploads rows AND their R2 objects (uploads/ prefix)', async () => {
        const { drizzle } = await import('drizzle-orm/d1');
        (drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        const docKey = `uploads/${TENANT}/i-1/doc-1-prior-report.pdf`;
        await testDb.insert(schema.clientUploads).values({
            id: 'doc-1', tenantId: TENANT, inspectionId: 'i-1',
            uploadedByKind: 'client', uploadedByRef: 'jane@test.com', uploadedByName: 'Jane',
            category: 'prior_reports', visibility: 'client_visible',
            r2Key: docKey, filename: 'prior-report.pdf', contentType: 'application/pdf',
            sizeBytes: 1234, label: null, createdAt: new Date(),
        });

        // Both prefixes present: a tenant photo AND the client-document object.
        const r2 = makeR2([
            { key: `tenants/${TENANT}/p1.jpg`, size: 100 },
            { key: docKey, size: 1234 },
        ]);
        const kv = makeKv();
        const svc = new TenantPurgeService({} as D1Database, r2.bucket, kv.ns);
        await svc.purge(TENANT);

        // (a) rows gone
        const remaining = await testDb.select().from(schema.clientUploads).all();
        expect(remaining).toHaveLength(0);
        // (b) R2 object for the client document was deleted
        expect(r2.deleted).toContain(docKey);
    });

    it('purges R2 objects stored under the unified {tenantId}/ root (new convention)', async () => {
        const { drizzle } = await import('drizzle-orm/d1');
        (drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        // Seed objects that follow the unified R2 key convention: bare tenantId root.
        const photoKey = `${TENANT}/inspections/i-1/photos/m-1.jpg`;
        const docKey   = `${TENANT}/inspections/i-1/documents/doc-1-file.pdf`;
        const r2 = makeR2([
            { key: photoKey, size: 512 },
            { key: docKey,   size: 2048 },
        ]);
        const kv = makeKv();
        const svc = new TenantPurgeService({} as D1Database, r2.bucket, kv.ns);

        const result = await svc.purge(TENANT);

        // Both new-convention objects must be deleted and counted.
        expect(r2.deleted).toContain(photoKey);
        expect(r2.deleted).toContain(docKey);
        expect(result.r2).toBe(2);
        expect(result.r2Bytes).toBe(2560);
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

    it('purges previously-uncovered tenant tables (invoices, messages, access tokens)', async () => {
        const { drizzle } = await import('drizzle-orm/d1');
        (drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        await testDb.insert(schema.invoices).values({
            id: 'inv-1', tenantId: TENANT, inspectionId: 'i-1', amountCents: 5000,
            lineItems: [{ description: 'Inspection', amountCents: 5000 }], createdAt: new Date(),
        } as never);
        await testDb.insert(schema.inspectionMessages).values({
            id: 'msg-1', tenantId: TENANT, inspectionId: 'i-1', fromRole: 'client',
            body: 'When is my report ready?', createdAt: Date.now(),
        } as never);
        await testDb.insert(schema.inspectionAccessTokens).values({
            id: 'tok-1', tenantId: TENANT, inspectionId: 'i-1', recipientEmail: 'jane@test.com',
            role: 'client', token: crypto.randomUUID(), createdAt: Date.now(),
        } as never);

        const svc = new TenantPurgeService({} as D1Database, makeR2([]).bucket, makeKv().ns);
        await svc.purge(TENANT);

        expect(await testDb.select().from(schema.invoices).all()).toHaveLength(0);
        expect(await testDb.select().from(schema.inspectionMessages).all()).toHaveLength(0);
        expect(await testDb.select().from(schema.inspectionAccessTokens).all()).toHaveLength(0);
    });

    it('derived tenant-scoped set covers tenant_id tables but excludes the destruction ledger', () => {
        const names = new Set(tenantScopedTables().map(getTableName));
        for (const t of ['invoices', 'inspection_messages', 'inspection_access_tokens']) {
            expect(names.has(t), `tenant purge must cover ${t}`).toBe(true);
        }
        // The durable, non-personal compliance proof must survive the purge.
        expect(names.has('tenant_destruction_records')).toBe(false);
    });
});
