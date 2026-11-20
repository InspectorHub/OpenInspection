/**
 * Import-archive service tests. A package's e-sign evidence is stored as a
 * byte-identical R2 object plus an import_archives ledger row. Verification uses
 * the same chain verifier as a downloadable evidence pack; NOTHING is written to
 * the live esign tables. The ledger row is idempotent by (tenant, package).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { createTestDb, setupSchema } from '../db';
import { lazyD1 } from '../helpers/d1-binding';
import * as schema from '../../../server/lib/db/schema';
import { importArchives } from '../../../server/lib/db/schema/data-package';
import { DataPackageArchiveImportService } from '../../../server/services/data-package/import-archive.service';
import type { PackEvent, PackKey } from '../../../server/lib/esign/chain-verify';
import { AuditLogService } from '../../../server/services/audit-log.service';
import { SigningKeyService } from '../../../server/services/signing-key.service';
import { sha256Hex } from '../../../server/lib/sha256';

const TENANT = '00000000-0000-0000-0000-000000000001';
const REQ = '00000000-0000-0000-0000-000000000100';
const PKG = 'pkg-1';

function mockBucket() {
    const objects = new Map<string, Uint8Array>();
    let puts = 0;
    return {
        objects,
        get puts() { return puts; },
        async put(key: string, bytes: ArrayBuffer | Uint8Array) {
            puts += 1;
            objects.set(key, new Uint8Array(bytes as ArrayBuffer));
            return { key };
        },
    };
}

describe('DataPackageArchiveImportService', () => {
    let db: any;
    let sqlite: any;
    let bucket: ReturnType<typeof mockBucket>;
    let testD1: ReturnType<typeof lazyD1>;
    let svc: DataPackageArchiveImportService;
    let events: PackEvent[];
    let keys: PackKey[];

    beforeEach(async () => {
        const fx = createTestDb();
        db = fx.db;
        sqlite = fx.sqlite;
        await setupSchema(sqlite);
        bucket = mockBucket();
        testD1 = lazyD1();
        testD1.use(db);
        await db.insert(schema.tenants).values({ id: TENANT, slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() });
        const keySvc = new SigningKeyService(testD1.binding, 'unit-test-key-encryption-secret-32b');
        const audit = new AuditLogService(testD1.binding, keySvc);
        await audit.append(TENANT, REQ, 'request.created', { at: 1 });
        await audit.append(TENANT, REQ, 'signer.signed', { signerId: 's1', onBehalfOf: null, tsMs: 5, name: 'A' });
        const rows = await db.select().from(schema.esignAuditLogs).orderBy(asc(schema.esignAuditLogs.createdAt)).all();
        events = rows.map((r: typeof schema.esignAuditLogs.$inferSelect) => ({
            id: r.id, event: r.event, payloadJson: r.payloadJson,
            prevHash: r.prevHash, hash: r.hash, signature: r.signature, keyFingerprint: r.keyFingerprint,
        }));
        const fingerprints = [...new Set(events.map((e) => e.keyFingerprint))];
        keys = (await Promise.all(fingerprints.map((fp) => keySvc.getPublicKeyByFingerprint(TENANT, fp))))
            .filter(Boolean).map((k) => ({ fingerprint: k!.fingerprint, pem: k!.pem }));
        svc = new DataPackageArchiveImportService(db, bucket as any, {
            now: () => 1_700_000_000_000, genId: (() => { let n = 0; return () => `arc-${++n}`; })(),
        });
    });

    const rawBytes = () => new TextEncoder().encode(JSON.stringify({ events, keys }));

    it('stores evidence bytes in R2, writes the ledger, and verifies a genuine chain', async () => {
        const bytes = rawBytes();
        const r = await svc.archive(TENANT, PKG, events, keys, bytes, ['req-src-1']);
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.verdict.problems).toEqual([]);
        expect(bucket.puts).toBe(1);
        expect(bucket.objects.has(`evidence-archives/${TENANT}/${PKG}/`)).toBe(true);
        const ledger = await db.select().from(importArchives).where(eq(importArchives.tenantId, TENANT)).all();
        expect(ledger).toHaveLength(1);
        expect(ledger[0]!.sha256).toBe(await sha256Hex(bytes));
    });

    it('does NOT write any live signing table', async () => {
        const before = (await db.select().from(schema.esignAuditLogs).all()).length;
        await svc.archive(TENANT, PKG, events, keys, rawBytes(), ['req-src-1']);
        expect((await db.select().from(schema.esignAuditLogs).all()).length).toBe(before);
    });

    it('is idempotent by tenant + package', async () => {
        await svc.archive(TENANT, PKG, events, keys, rawBytes(), ['r1']);
        const second = await svc.archive(TENANT, PKG, events, keys, rawBytes(), ['r1']);
        expect(second.ok).toBe(false);
        if (!second.ok) expect(second.code).toBe('already_archived');
        expect(bucket.puts).toBe(1);
    });

    it('reports chain problems but still archives the bytes (tampered fixture)', async () => {
        const tampered = events.map((e, i) => i === 0 ? { ...e, payloadJson: '{"tampered":true}' } : e);
        const r = await svc.archive(TENANT, PKG + '-tampered', tampered, keys, rawBytes(), ['r1']);
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.verdict.problems.length).toBeGreaterThan(0);
        expect(bucket.puts).toBe(1); // bytes still preserved verbatim
    });
});
