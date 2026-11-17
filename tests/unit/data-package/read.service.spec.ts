/**
 * E-1 row reader tests. Runs parameterized SQL against a real in-memory SQLite
 * database with the full migration schema, so keyset ordering, watermark cuts,
 * verbatim JSON and blob chunking are exercised for real.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { createTestDb } from '../db';
import { asScopedDbSource } from '../helpers/test-db';
import { DataPackageReadService } from '../../../server/services/data-package/read.service';
import { encodeCursor } from '../../../server/lib/data-package/cursor';
import { inspections, inspectionResults, esignAuditLogs, contacts, tenants } from '../../../server/lib/db/schema';
import { ErrorCode } from '../../../server/lib/errors';

const T1 = 'tenant-1';
const T2 = 'tenant-2';
const SNAPSHOT = 1_700_000_000_000;

describe('DataPackageReadService', () => {
    let db: any;
    let svc: DataPackageReadService;

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db;
        svc = new DataPackageReadService(asScopedDbSource(setup.db));
        await db.insert(tenants).values([
            { id: T1, slug: 't1', createdAt: new Date(SNAPSHOT - 100000) },
            { id: T2, slug: 't2', createdAt: new Date(SNAPSHOT - 90000) },
        ]);
        // Seed a few inspections: two in T1 (one before, one after the snapshot), one in T2.
        await db.insert(inspections).values([
            { id: 'insp-a', tenantId: T1, propertyAddress: 'A', status: 'scheduled', date: '2026-01-01', createdAt: new Date(SNAPSHOT - 1000) },
            { id: 'insp-b', tenantId: T1, propertyAddress: 'B', status: 'scheduled', date: '2026-01-01', createdAt: new Date(SNAPSHOT + 1000) },
            { id: 'insp-c', tenantId: T2, propertyAddress: 'C', status: 'scheduled', date: '2026-01-01', createdAt: new Date(SNAPSHOT - 2000) },
        ]);
    });

    it('projects the table descriptors from classification with page ceilings', () => {
        const tables = svc.tables('worker-free');
        const names = tables.map((t) => t.table);
        expect(names).toContain('inspections');
        expect(names).toContain('esign_audit_logs');
        expect(names).not.toContain('tenant_data_jobs'); // outTable
        const esign = tables.find((t) => t.table === 'esign_audit_logs')!;
        expect(esign.keyset).toEqual(['created_at', 'rowid']);
        expect(esign.columns).toContain('payload_json');
        expect(esign.blobColumns.map((b) => b.name)).toContain('payload_json');
    });

    it('reads a keyset page scoped to the tenant and cut at the snapshot watermark', async () => {
        const page = await svc.readRows(T1, 'inspections', undefined, 50, SNAPSHOT, 'worker-paid');
        const ids = page.rows.map((r) => r.id);
        expect(ids).toEqual(['insp-a']); // insp-b is after watermark; insp-c is another tenant
        expect(page.next).toBeNull();
        expect(page.rowsScanned).toBeGreaterThanOrEqual(1);
    });

    it('paginates with a stateless cursor and never crosses tenants', async () => {
        // Insert several rows within the watermark so pagination has multiple pages.
        const extra = Array.from({ length: 5 }, (_, i) => ({
            id: `insp-${String(i).padStart(2, '0')}`, tenantId: T1, propertyAddress: `P${i}`,
            status: 'scheduled' as const, date: '2026-01-01', createdAt: new Date(SNAPSHOT - 5000 + i),
        }));
        await db.insert(inspections).values(extra);

        const seen: string[] = [];
        let cursor: string | undefined;
        for (let guard = 0; guard < 10; guard++) {
            const page = await svc.readRows(T1, 'inspections', cursor, 2, SNAPSHOT, 'worker-paid');
            seen.push(...page.rows.map((r) => r.id as string));
            expect(page.rows.every((r) => r.tenant_id === T1)).toBe(true);
            cursor = page.next ?? undefined;
            if (!cursor) break;
        }
        expect(seen).toEqual([...new Set(seen)].sort()); // no dupes, keyset order
        expect(seen).toContain('insp-00');
        expect(seen).toContain('insp-a');
        expect(seen).not.toContain('insp-b'); // after watermark
        expect(seen).not.toContain('insp-c'); // other tenant
    });

    it('returns stored JSON verbatim (no normalization)', async () => {
        // Seed the exact stored text via raw SQL: a mode:'json' Drizzle insert
        // would serialize again and defeat the point of this test.
        await db.run(sql`INSERT INTO inspection_results (id, tenant_id, inspection_id, data, last_synced_at)
            VALUES ('r1', ${T1}, 'insp-a', '"double-encoded"', ${SNAPSHOT - 10})`);
        const page = await svc.readRows(T1, 'inspection_results', undefined, 50, SNAPSHOT, 'worker-paid');
        expect(page.rows).toHaveLength(1);
        expect(page.rows[0]!.data).toBe('"double-encoded"');
    });

    it('reads the e-sign chain in created_at,rowid order with a rowid cursor', async () => {
        const base = {
            tenantId: T1, requestId: 'req-1', event: 'signer.signed' as const,
            hash: 'h', signature: 's', keyFingerprint: 'kf',
        };
        await db.insert(esignAuditLogs).values([
            { ...base, id: 'e2', payloadJson: '{}', prevHash: 'e1', createdAt: new Date(SNAPSHOT - 1000) },
            { ...base, id: 'e1', payloadJson: '{}', prevHash: null, createdAt: new Date(SNAPSHOT - 2000) },
        ]);
        const page1 = await svc.readRows(T1, 'esign_audit_logs', undefined, 1, SNAPSHOT, 'worker-paid');
        expect(page1.rows.map((r) => r.id)).toEqual(['e1']);
        expect(page1.next).not.toBeNull();
        // The continuation cursor carries (created_at ms, rowid); rowid is a
        // cursor-only key and is never exposed as a row column.
        const decoded = JSON.parse(Buffer.from(page1.next!, 'base64url').toString('utf8'));
        expect(decoded).toHaveLength(2);
        expect(decoded[1]).toBeTypeOf('number');
        const page2 = await svc.readRows(T1, 'esign_audit_logs', page1.next!, 1, SNAPSHOT, 'worker-paid');
        expect(page2.rows.map((r) => r.id)).toEqual(['e2']);
        expect(page2.next).toBeNull();
    });

    it('reads a blob column chunk by keyset with tenant scope', async () => {
        const big = 'x'.repeat(5000);
        await db.insert(inspectionResults).values([
            { id: 'r1', tenantId: T1, inspectionId: 'insp-a', data: '{}' as any, ydocState: Buffer.from(big), lastSyncedAt: new Date(SNAPSHOT - 10) },
        ]);
        const key = encodeCursor(['r1']);
        const chunk = await svc.readColumnChunk(T1, 'inspection_results', 'ydoc_state', key, 0, 1024);
        expect(chunk.data.length).toBe(1024);
        expect(chunk.totalBytes).toBe(5000);
        expect(chunk.nextOffset).toBe(1024);
        const last = await svc.readColumnChunk(T1, 'inspection_results', 'ydoc_state', key, 4096, 1024);
        expect(last.data.length).toBe(904);
        expect(last.nextOffset).toBeNull();
    });

    it('reads the tenants row itself via tenant_row scope (id, not tenant_id)', async () => {
        const meta = svc.tables('worker-paid').find((t) => t.table === 'tenants')!;
        expect(meta.keyset).toEqual(['id']);
        // tenants is keyed/matched on id (not tenant_id); the generic tenant_id
        // predicate would throw "no such column". Both tenants resolve to one row.
        const page = await svc.readRows(T1, 'tenants', undefined, 50, SNAPSHOT, 'worker-paid');
        expect(page.rows).toHaveLength(1);
        const other = await svc.readRows(T2, 'tenants', undefined, 50, SNAPSHOT, 'worker-paid');
        expect(other.rows).toHaveLength(1);
        expect(other.rows[0]).not.toEqual(page.rows[0]);
    });

    it('does not drop rows when the byte budget cuts a page short', async () => {
        // Free-tier inspections: 48 rows / 96 KiB. Seed 40 rows each ~3 KiB so
        // the byte budget stops well before the row cap, with hasMore=false.
        const rows = Array.from({ length: 40 }, (_, i) => ({
            id: `big-${String(i).padStart(2, '0')}`, tenantId: T1,
            propertyAddress: 'A'.repeat(3000), status: 'scheduled' as const,
            date: '2026-01-01', createdAt: new Date(SNAPSHOT - 5000 + i),
        }));
        await db.insert(inspections).values(rows);
        const seen = new Set<string>();
        let cursor: string | undefined;
        for (let guard = 0; guard < 60; guard++) {
            const page = await svc.readRows(T1, 'inspections', cursor, 50, SNAPSHOT, 'worker-free');
            page.rows.forEach((r) => seen.add(r.id as string));
            cursor = page.next ?? undefined;
            if (!cursor) break;
        }
        // Every seeded T1 row within the watermark must eventually be returned.
        expect(seen.size).toBe(40 + 1); // 40 big rows + insp-a
    });

    it('chunks a TEXT column by bytes, not characters', async () => {
        const payload = '用户abc'; // 2 CJK (6 bytes UTF-8) + 3 ASCII = 9 bytes, 5 chars
        await db.insert(esignAuditLogs).values([
            { ...{ tenantId: T1, requestId: 'req-1', event: 'signer.signed' as const, hash: 'h', signature: 's', keyFingerprint: 'kf' },
              id: 'e1', payloadJson: payload, prevHash: null, createdAt: new Date(SNAPSHOT - 1000) },
        ]);
        const key = encodeCursor([SNAPSHOT - 1000, 1]); // (created_at ms, rowid)
        const chunk = await svc.readColumnChunk(T1, 'esign_audit_logs', 'payload_json', key, 0, 6);
        expect(chunk.totalBytes).toBe(9); // bytes, not 5 characters
        expect(chunk.data).toBeInstanceOf(Uint8Array);
        expect(Buffer.from(chunk.data).toString('utf8')).toBe('用户');
        expect(chunk.nextOffset).toBe(6);
    });

    it('rejects an unknown table, unknown column and malformed cursor', async () => {
        await expect(svc.readRows(T1, 'tenant_data_jobs', undefined, 10, SNAPSHOT, 'worker-paid'))
            .rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
        await expect(svc.readColumnChunk(T1, 'inspections', 'property_address', encodeCursor(['insp-a']), 0, 10))
            .rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
        await expect(svc.readRows(T1, 'inspections', '!!!', 10, SNAPSHOT, 'worker-paid'))
            .rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST });
    });

    it('cannot read another tenant row via a crafted chunk key', async () => {
        await db.insert(inspectionResults).values([
            { id: 'r1', tenantId: T2, inspectionId: 'insp-c', data: '{}' as any, ydocState: Buffer.from('secret'), lastSyncedAt: new Date(SNAPSHOT - 10) },
        ]);
        await expect(svc.readColumnChunk(T1, 'inspection_results', 'ydoc_state', encodeCursor(['r1']), 0, 10))
            .rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });
});
