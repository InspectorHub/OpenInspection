/**
 * Task 3 (see #181) — asserts that `inspection_results.ydoc_state` round-trips
 * a raw binary payload (Uint8Array) through the D1-backed SQLite harness without
 * corruption. This is the only BLOB column in the schema; the test verifies that
 * drizzle-orm/better-sqlite3 serialises it correctly and that the baseline
 * migration contains the column.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { inspections, inspectionResults, tenants } from '../../../server/lib/db/schema';

describe('inspection_results.ydoc_state blob round-trip', () => {
    let db: BetterSQLite3Database;
    let sqlite: any;

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);

        // Seed required parent rows (app-layer refs — D1 has no runtime FK
        // enforcement, but the harness schema was generated from the Drizzle
        // definition which still carries .references() on these columns in the
        // legacy frozen set; better-sqlite3 honours PRAGMA foreign_keys).
        await db.insert(tenants).values({
            id: 't-collab',
            name: 'Collab Test Tenant',
            slug: 'collab-test',
            createdAt: new Date(),
        } as any);

        await db.insert(inspections).values({
            id: 'i-collab',
            tenantId: 't-collab',
            propertyAddress: '1 Collab Ave',
            date: '2026-01-01',
            status: 'requested',
            createdAt: new Date(),
        } as any);
    });

    afterEach(() => {
        sqlite.close();
    });

    it('stores and retrieves a Uint8Array ydocState identical byte-for-byte', async () => {
        // A minimal synthetic Y.Doc state update vector (16 bytes).
        const docBytes = new Uint8Array([0x01, 0x00, 0x05, 0x01, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01]);

        await db.insert(inspectionResults).values({
            id: 'ir-collab',
            tenantId: 't-collab',
            inspectionId: 'i-collab',
            data: {},
            lastSyncedAt: new Date(0),
            ydocState: docBytes,
        } as any);

        const row = await db
            .select()
            .from(inspectionResults)
            .where(
                (await import('drizzle-orm')).eq(inspectionResults.id, 'ir-collab'),
            )
            .get();

        expect(row).toBeDefined();
        // D1/better-sqlite3 returns BLOBs as Buffer (Node.js Buffer extends
        // Uint8Array), so a Uint8Array comparison via Buffer.from works correctly.
        const returned = row!.ydocState as Uint8Array | Buffer | null;
        expect(returned).not.toBeNull();
        expect(Buffer.from(returned!)).toEqual(Buffer.from(docBytes));
    });

    it('allows null ydocState for inspections not yet edited collaboratively', async () => {
        await db.insert(inspectionResults).values({
            id: 'ir-collab-null',
            tenantId: 't-collab',
            inspectionId: 'i-collab',
            data: {},
            lastSyncedAt: new Date(0),
            // ydocState intentionally omitted (defaults to null)
        } as any);

        const row = await db
            .select()
            .from(inspectionResults)
            .where(
                (await import('drizzle-orm')).eq(inspectionResults.id, 'ir-collab-null'),
            )
            .get();

        expect(row).toBeDefined();
        expect(row!.ydocState).toBeNull();
    });
});
