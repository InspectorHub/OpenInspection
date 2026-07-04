/**
 * Contacts CSV bulk-import — parser + two-phase insert behaviour.
 *
 * Covers:
 *  - parseCsvPreview: column inference, 20-row cap + truncated flag,
 *    quoted-field tolerance.
 *  - importContacts (B-29+ two-phase): phase 1 validates EVERY row in memory
 *    (name required, email format, in-file duplicate emails) and dedupes
 *    against the DB; ANY validation error → full error list returned, ZERO
 *    rows written (the old row-by-row insert left earlier rows behind, so a
 *    fixed-file retry duplicated them). Phase 2 inserts all rows in one
 *    chunked db.batch() (D1 100-bind limit), atomic on D1.
 *  - skipped ≠ error: blank names and already-in-DB emails are deliberate
 *    skips (keeps re-importing an appended export workable); errors are file
 *    problems the user must fix.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parseCsvPreview, importContacts } from '../../../server/services/contacts-import.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

describe('parseCsvPreview', () => {
    it('infers columns from header and returns first 20 rows', () => {
        const csv = ['name,email,phone', 'Alice,alice@x.com,555-1', 'Bob,bob@x.com,555-2'].join('\n');
        const result = parseCsvPreview(csv);
        expect(result.columns).toEqual(['name', 'email', 'phone']);
        expect(result.rows).toHaveLength(2);
        expect(result.rows[0]).toEqual({ name: 'Alice', email: 'alice@x.com', phone: '555-1' });
        expect(result.truncated).toBe(false);
    });

    it('caps rows at 20 and reports truncated=true', () => {
        const header = 'name';
        const dataRows = Array.from({ length: 25 }, (_, i) => `Person${i}`);
        const csv = [header, ...dataRows].join('\n');
        const result = parseCsvPreview(csv);
        expect(result.rows).toHaveLength(20);
        expect(result.totalRowsDetected).toBe(25);
        expect(result.truncated).toBe(true);
    });

    it('handles quoted fields with embedded commas', () => {
        const csv = ['name,agency', '"Alice","Acme, Inc."'].join('\n');
        const result = parseCsvPreview(csv);
        expect(result.rows[0]).toEqual({ name: 'Alice', agency: 'Acme, Inc.' });
    });

    it('returns empty result for empty input', () => {
        const result = parseCsvPreview('');
        expect(result.columns).toEqual([]);
        expect(result.rows).toEqual([]);
        expect(result.totalRowsDetected).toBe(0);
        expect(result.truncated).toBe(false);
    });
});

describe('importContacts', () => {
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        await testDb.insert(schema.tenants).values({
            id: TENANT_ID,
            name: 'Test Tenant',
            slug: 'test',
            status: 'active',
            deploymentMode: 'shared',
            tier: 'free',
            createdAt: new Date(),
        });
    });

    it('inserts rows matching the mapping and skips blank names', async () => {
        const csv = ['n,e', 'Alice,alice@x.com', ',blank@x.com', 'Bob,bob@x.com'].join('\n');
        const result = await importContacts(testDb as any, TENANT_ID, csv, { name: 'n', email: 'e' });
        expect(result.inserted).toBe(2);
        expect(result.skipped).toBe(1);
        const rows = await testDb.select().from(schema.contacts).all();
        expect(rows).toHaveLength(2);
        expect(rows.map((r) => r.name).sort()).toEqual(['Alice', 'Bob']);
    });

    it('records per-row errors with row numbers', async () => {
        const csv = ['n,e', 'Charlie,not-an-email'].join('\n');
        const result = await importContacts(testDb as any, TENANT_ID, csv, { name: 'n', email: 'e' });
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toMatchObject({ row: 2 });
        expect(result.errors[0].message).toMatch(/email/i);
        expect(result.inserted).toBe(0);
    });

    it('a single bad row blocks the WHOLE file — zero rows written (all-or-nothing)', async () => {
        const csv = ['n,e', 'Alice,alice@x.com', 'Charlie,not-an-email', 'Bob,bob@x.com'].join('\n');
        const result = await importContacts(testDb as any, TENANT_ID, csv, { name: 'n', email: 'e' });
        expect(result.errors).toHaveLength(1);
        expect(result.inserted).toBe(0);
        // The old row-by-row insert left Alice behind here → fixed-file retry
        // duplicated her. Validate-first must leave the table untouched.
        expect(await testDb.select().from(schema.contacts).all()).toHaveLength(0);
    });

    it('reports ALL row errors in one pass, not just the first', async () => {
        const csv = ['n,e', 'A,bad-1', 'B,ok@x.com', 'C,bad-2'].join('\n');
        const result = await importContacts(testDb as any, TENANT_ID, csv, { name: 'n', email: 'e' });
        expect(result.errors.map((e) => e.row).sort()).toEqual([2, 4]);
        expect(await testDb.select().from(schema.contacts).all()).toHaveLength(0);
    });

    it('flags in-file duplicate emails as errors (case-insensitive, later row blamed)', async () => {
        const csv = ['n,e', 'Alice,alice@x.com', 'Alias,ALICE@X.COM'].join('\n');
        const result = await importContacts(testDb as any, TENANT_ID, csv, { name: 'n', email: 'e' });
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toMatchObject({ row: 3 });
        expect(result.errors[0].message).toMatch(/duplicate/i);
        expect(await testDb.select().from(schema.contacts).all()).toHaveLength(0);
    });

    it('skips rows whose email already exists in this tenant (idempotent re-import, not an error)', async () => {
        await testDb.insert(schema.contacts).values({
            id: 'c-existing', tenantId: TENANT_ID, type: 'client',
            name: 'Alice', email: 'alice@x.com', createdAt: new Date(),
        });
        const csv = ['n,e', 'Alice,ALICE@x.com', 'Bob,bob@x.com'].join('\n');
        const result = await importContacts(testDb as any, TENANT_ID, csv, { name: 'n', email: 'e' });
        expect(result.errors).toHaveLength(0);
        expect(result.skipped).toBe(1);
        expect(result.inserted).toBe(1);
        const rows = await testDb.select().from(schema.contacts).all();
        expect(rows.map((r) => r.name).sort()).toEqual(['Alice', 'Bob']);
    });

    it('an ARCHIVED contact with the same email does not block the import (mirrors the DB-9 partial unique index)', async () => {
        await testDb.insert(schema.contacts).values({
            id: 'c-archived', tenantId: TENANT_ID, type: 'client',
            name: 'Alice', email: 'alice@x.com', createdAt: new Date(),
            archivedAt: new Date(),
        });
        const csv = ['n,e', 'Alice,alice@x.com'].join('\n');
        const result = await importContacts(testDb as any, TENANT_ID, csv, { name: 'n', email: 'e' });
        expect(result.inserted).toBe(1);
        expect(result.skipped).toBe(0);
    });

    it('does not dedupe against another tenant\'s contacts', async () => {
        await testDb.insert(schema.tenants).values({
            id: 'other-tenant', name: 'Other', slug: 'other', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await testDb.insert(schema.contacts).values({
            id: 'c-other', tenantId: 'other-tenant', type: 'client',
            name: 'Alice', email: 'alice@x.com', createdAt: new Date(),
        });
        const csv = ['n,e', 'Alice,alice@x.com'].join('\n');
        const result = await importContacts(testDb as any, TENANT_ID, csv, { name: 'n', email: 'e' });
        expect(result.inserted).toBe(1);
        expect(result.skipped).toBe(0);
    });

    it('inserts all valid rows through ONE db.batch when the driver supports it (chunked by bind limit)', async () => {
        const batchSpy = vi.fn(async (stmts: unknown[]) => {
            for (const s of stmts) await s;
        });
        (testDb as any).batch = batchSpy;

        // 30 rows × 8 bound columns ≈ 240 binds → must chunk ≤12 rows/stmt
        // (D1 caps 100 binds per prepared statement) inside one atomic batch.
        const rows = Array.from({ length: 30 }, (_, i) => `P${i},p${i}@x.com`);
        const csv = ['n,e', ...rows].join('\n');
        const result = await importContacts(testDb as any, TENANT_ID, csv, { name: 'n', email: 'e' });

        expect(result.inserted).toBe(30);
        expect(batchSpy).toHaveBeenCalledTimes(1);
        expect((batchSpy.mock.calls[0]![0] as unknown[]).length).toBeGreaterThanOrEqual(3);
        expect(await testDb.select().from(schema.contacts).all()).toHaveLength(30);
    });

    it('honours optional agency/phone mappings', async () => {
        const csv = ['name,phone,agency', 'Dana,555-9,Acme'].join('\n');
        const result = await importContacts(testDb as any, TENANT_ID, csv, {
            name: 'name', phone: 'phone', agency: 'agency',
        });
        expect(result.inserted).toBe(1);
        const rows = await testDb.select().from(schema.contacts).all();
        expect(rows[0]).toMatchObject({ name: 'Dana', phone: '555-9', agency: 'Acme' });
    });

    it('defaults type to client when mapping omits it, honours agent override', async () => {
        const csv = ['name', 'Alice', 'Bob'].join('\n');
        const r1 = await importContacts(testDb as any, TENANT_ID, csv, { name: 'name' });
        expect(r1.inserted).toBe(2);
        let rows = await testDb.select().from(schema.contacts).all();
        expect(rows.every((r) => r.type === 'client')).toBe(true);
        // Reset table, re-run with agent
        await testDb.delete(schema.contacts);
        const r2 = await importContacts(testDb as any, TENANT_ID, csv, { name: 'name', type: 'agent' });
        expect(r2.inserted).toBe(2);
        rows = await testDb.select().from(schema.contacts).all();
        expect(rows.every((r) => r.type === 'agent')).toBe(true);
    });
});
