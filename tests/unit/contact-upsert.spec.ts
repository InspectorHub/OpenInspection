/**
 * IA-1 — ContactService.upsertClientContact unit tests.
 *
 * Uses in-memory SQLite + real migrations (same pattern as inspection-patch-settings.spec.ts).
 * ContactService uses drizzle-orm/d1 internally; we mock that import to return the
 * better-sqlite3 drizzle instance, which has the same query API.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../server/lib/db/schema';
import { createTestDb, setupSchema } from './db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq, and, isNull } from 'drizzle-orm';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { ContactService } from '../../server/services/contact.service';

const TENANT = '00000000-0000-0000-0000-000000000001';

let db: BetterSQLite3Database<typeof schema>;
let service: ContactService;

beforeEach(async () => {
    const fixture = createTestDb();
    db = fixture.db;
    await setupSchema(fixture.sqlite);

    // Seed the tenant row required by foreign key (enforced by better-sqlite3).
    await db.insert(schema.tenants).values({
        id: TENANT, name: 'Test Tenant', slug: 'test-tenant', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });

    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    // ContactService accepts a D1Database; we pass {} as a placeholder since
    // mockDrizzle intercepts every internal call.
    service = new ContactService({} as D1Database);
});

// ---------------------------------------------------------------------------
// 1. Email match reuses an existing active row
// ---------------------------------------------------------------------------
describe('email match reuses row', () => {
    it('returns the existing id and created:false when the email already exists', async () => {
        const existingId = crypto.randomUUID();
        await db.insert(schema.contacts).values({
            id: existingId, tenantId: TENANT, type: 'client', name: 'Old Name',
            email: 'alice@example.com', phone: null, agency: null, notes: null,
            createdAt: new Date(),
        });

        const result = await service.upsertClientContact(TENANT, {
            name: 'Alice Smith', email: 'alice@example.com', type: 'client',
        });

        expect(result).toEqual({ id: existingId, created: false });
        // Row count must remain 1 for this tenant+email.
        const rows = await db.select().from(schema.contacts)
            .where(and(eq(schema.contacts.tenantId, TENANT), eq(schema.contacts.email, 'alice@example.com')));
        expect(rows).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// 2. Fill-forward fills a null phone
// ---------------------------------------------------------------------------
describe('fill-forward fills empty phone', () => {
    it('updates phone when existing value is null and new input has a phone', async () => {
        const existingId = crypto.randomUUID();
        await db.insert(schema.contacts).values({
            id: existingId, tenantId: TENANT, type: 'client', name: 'Bob',
            email: 'bob@example.com', phone: null, agency: null, notes: null,
            createdAt: new Date(),
        });

        await service.upsertClientContact(TENANT, {
            name: 'Bob', email: 'bob@example.com', phone: '555-1234', type: 'client',
        });

        const row = await db.select().from(schema.contacts)
            .where(eq(schema.contacts.id, existingId)).get();
        expect(row?.phone).toBe('555-1234');
    });
});

// ---------------------------------------------------------------------------
// 3. Fill-forward does NOT overwrite an existing non-empty phone
// ---------------------------------------------------------------------------
describe('fill-forward does not overwrite non-empty phone', () => {
    it('leaves existing phone unchanged when the row already has a value', async () => {
        const existingId = crypto.randomUUID();
        await db.insert(schema.contacts).values({
            id: existingId, tenantId: TENANT, type: 'client', name: 'Carol',
            email: 'carol@example.com', phone: '999-8888', agency: null, notes: null,
            createdAt: new Date(),
        });

        await service.upsertClientContact(TENANT, {
            name: 'Carol', email: 'carol@example.com', phone: '111-2222', type: 'client',
        });

        const row = await db.select().from(schema.contacts)
            .where(eq(schema.contacts.id, existingId)).get();
        // Existing phone must be preserved.
        expect(row?.phone).toBe('999-8888');
    });
});

// ---------------------------------------------------------------------------
// 4. No-email always inserts a new row
// ---------------------------------------------------------------------------
describe('no-email always inserts', () => {
    it('creates a brand-new row when no email is provided', async () => {
        const before = await db.select().from(schema.contacts)
            .where(eq(schema.contacts.tenantId, TENANT));

        const result = await service.upsertClientContact(TENANT, {
            name: 'Dave NoEmail', type: 'client',
        });

        const after = await db.select().from(schema.contacts)
            .where(eq(schema.contacts.tenantId, TENANT));

        expect(result.created).toBe(true);
        expect(after).toHaveLength(before.length + 1);

        const row = await db.select().from(schema.contacts)
            .where(eq(schema.contacts.id, result.id)).get();
        expect(row?.name).toBe('Dave NoEmail');
        expect(row?.email).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// 5. Archived row with same email is NOT matched — a new active row is created
// ---------------------------------------------------------------------------
describe('archived row is not matched', () => {
    it('inserts a fresh active row when an archived row shares the email', async () => {
        const archivedId = crypto.randomUUID();
        await db.insert(schema.contacts).values({
            id: archivedId, tenantId: TENANT, type: 'client', name: 'Eve Old',
            email: 'eve@example.com', phone: null, agency: null, notes: null,
            createdAt: new Date(),
            // Mark as archived — partial unique index excludes this row.
            // timestamp_ms mode stores epoch ms but drizzle-orm expects a Date for insert.
            archivedAt: new Date(Date.now() - 86400000),
        });

        const result = await service.upsertClientContact(TENANT, {
            name: 'Eve New', email: 'eve@example.com', type: 'client',
        });

        // A NEW row must have been created (not the archived one).
        expect(result.created).toBe(true);
        expect(result.id).not.toBe(archivedId);

        // The new row is active (archivedAt IS NULL).
        const newRow = await db.select().from(schema.contacts)
            .where(eq(schema.contacts.id, result.id)).get();
        expect(newRow?.archivedAt).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// 6. Email matching is case-insensitive ('A@B.com' matches stored 'a@b.com')
// ---------------------------------------------------------------------------
describe('email case-insensitive match', () => {
    it('matches a stored lowercase email against an uppercase input', async () => {
        const existingId = crypto.randomUUID();
        await db.insert(schema.contacts).values({
            id: existingId, tenantId: TENANT, type: 'client', name: 'Frank',
            email: 'frank@example.com', phone: null, agency: null, notes: null,
            createdAt: new Date(),
        });

        const result = await service.upsertClientContact(TENANT, {
            name: 'Frank', email: 'FRANK@EXAMPLE.COM', type: 'client',
        });

        expect(result).toEqual({ id: existingId, created: false });
    });
});
