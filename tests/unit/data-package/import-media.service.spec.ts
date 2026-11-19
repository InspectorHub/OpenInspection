/**
 * Import media service tests. Media bytes from a package are copied to R2 under
 * the target tenant, with the source key NEVER deciding the destination in
 * rewrite mode. A sha256 mismatch or a key that escapes the tenant prefix
 * rejects that one object without failing the whole import; a retry skips
 * already-copied objects.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../db';
import { asScopedDbSource } from '../helpers/test-db';
import { DataPackageMediaImportService, type MediaImportDeps } from '../../../server/services/data-package/import-media.service';
import { importIdMap } from '../../../server/lib/db/schema/data-package';
import { sha256Hex } from '../../../server/lib/sha256';

const TENANT = 'tenant-target';
const PKG = 'pkg-1';

function mockBucket() {
    const objects = new Map<string, { bytes: Uint8Array; sha256?: string; contentType?: string }>();
    let putCalls = 0;
    return {
        objects,
        get putCalls() { return putCalls; },
        async put(key: string, bytes: ArrayBuffer | Uint8Array, opts?: { sha256?: string; httpMetadata?: { contentType?: string } }) {
            putCalls += 1;
            objects.set(key, {
                bytes: new Uint8Array(bytes as ArrayBuffer),
                sha256: opts?.sha256,
                contentType: opts?.httpMetadata?.contentType,
            });
            return { key };
        },
    };
}

describe('DataPackageMediaImportService', () => {
    let db: any;
    let bucket: ReturnType<typeof mockBucket>;
    let svc: DataPackageMediaImportService;
    let genCounter: () => string;

    const makeSvc = (keepIds: boolean, fakeNow = 1_700_000_000_000) => new DataPackageMediaImportService(
        asScopedDbSource(db), bucket as any, {
            now: () => fakeNow,
            genId: genCounter,
            keepIds,
        } as MediaImportDeps,
    );

    beforeEach(() => {
        const setup = createTestDb();
        db = setup.db;
        bucket = mockBucket();
        let n = 0;
        genCounter = () => `new-${++n}`;
    });

    const bytes = new TextEncoder().encode('photo-bytes');
    const row = {
        key: `${TENANT}/inspections/insp-1/photos/m-abc.jpg`,
        entry: 'media/a.jpg',
        bytes: bytes.length,
        sha256: '', // filled in beforeEach below via a getter
        volume: 'media-001.zip',
        content_type: 'image/jpeg',
        referenced_by: [{ table: 'inspection_media_pool', id: 'ref-1' }],
    };

    it('copies bytes to R2 under the target tenant with a verified checksum', async () => {
        const sha = await sha256Hex(bytes);
        const r = await makeSvc(true).importOne(TENANT, PKG, { ...row, sha256: sha }, bytes);
        expect(r.ok).toBe(true);
        expect(bucket.putCalls).toBe(1);
        const stored = [...bucket.objects.values()][0]!;
        expect(new TextDecoder().decode(stored.bytes)).toBe('photo-bytes');
        expect(stored.sha256).toBe(sha);
        expect(stored.contentType).toBe('image/jpeg');
    });

    it('rejects a checksum mismatch without writing to R2', async () => {
        const r = await makeSvc(true).importOne(TENANT, PKG, { ...row, sha256: 'f'.repeat(64) }, bytes);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.code).toBe('checksum_mismatch');
        expect(bucket.putCalls).toBe(0);
    });

    it('rewrites the key to the target tenant in rewrite mode; source key never decides destination', async () => {
        const sha = await sha256Hex(bytes);
        const r = await makeSvc(false).importOne(TENANT, PKG, { ...row, sha256: sha }, bytes);
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.newKey).not.toBe(row.key); // a fresh inspection segment was minted
        expect([...bucket.objects.keys()][0]).toMatch(new RegExp(`^${TENANT}/`));
    });

    it('keeps the source key in keep-ids mode (precondition: target id equals source id)', async () => {
        const sha = await sha256Hex(bytes);
        const r = await makeSvc(true).importOne(TENANT, PKG, { ...row, sha256: sha }, bytes);
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.newKey).toBe(row.key);
    });

    it('is idempotent: replaying the same source key skips the copy', async () => {
        const sha = await sha256Hex(bytes);
        const svc1 = makeSvc(true);
        const first = await svc1.importOne(TENANT, PKG, { ...row, sha256: sha }, bytes);
        expect(first.ok).toBe(true);
        const second = await svc1.importOne(TENANT, PKG, { ...row, sha256: sha }, bytes);
        expect(second.ok).toBe(false);
        if (!second.ok) expect(second.code).toBe('already_imported');
        expect(bucket.putCalls).toBe(1);
        expect(await db.select().from(importIdMap).where(eq(importIdMap.tenantId, TENANT)).all()).toHaveLength(1);
    });

    it('refuses a key that escapes the tenant prefix in keep-ids mode', async () => {
        const sha = await sha256Hex(bytes);
        const badRow = { ...row, key: '../escape/inspections/x/photos/m.jpg', sha256: sha };
        const r = await makeSvc(true).importOne(TENANT, PKG, badRow, bytes);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.code).toBe('unsafe_key');
        expect(bucket.putCalls).toBe(0);
    });
});
