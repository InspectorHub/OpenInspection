/**
 * Contacts CSV bulk-import — parser + insert behaviour.
 *
 * Covers:
 *  - parseCsvPreview: column inference, 20-row cap + truncated flag,
 *    quoted-field tolerance.
 *  - importContacts: mapping-driven inserts, blank-name skip, invalid-email
 *    per-row error capture without aborting the batch.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parseCsvPreview, importContacts } from '../../src/services/contacts-import.service';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../src/lib/db/schema';
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
            subdomain: 'test',
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

    it('records per-row errors without failing the whole import', async () => {
        const csv = ['n,e', 'Charlie,not-an-email'].join('\n');
        const result = await importContacts(testDb as any, TENANT_ID, csv, { name: 'n', email: 'e' });
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toMatchObject({ row: 2 });
        expect(result.errors[0].message).toMatch(/email/i);
        expect(result.inserted).toBe(0);
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
