/**
 * `audit_logs.metadata` is free-form JSON, and callers do put subject
 * identifiers in it (a recipient email on a report delivery, a phone on an SMS
 * send, a property address on an inspection update). Portal's review ruled on
 * the identical column (`audit_logs.details`) that carrying such a column
 * through an erasure is an incomplete DSAR. Portal then closed it in two
 * halves — redact at write, scrub on erasure. OI had neither (#276).
 *
 * These specs pin both halves, plus the thing redaction must not cost: the
 * structured event (action / entity) is why the row exists.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { auditFromContext, writeAuditLogWithSlug } from '../../../server/lib/audit';
import { ERASURE_MANIFEST } from '../../../server/lib/compliance/erasure-manifest';
import { runErasure } from '../../../server/lib/compliance/erasure-orchestrator';
import { createTestDb, setupSchema } from '../db';
import { asAnyDb } from '../helpers/test-db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { Context } from 'hono';
import type { HonoConfig } from '../../../server/types/hono';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-000000000001';
const USER = '00000000-0000-0000-0000-000000000010';
const SUBJECT = 'jane@example.com';

/** Minimal stand-in for the Hono context `auditFromContext` reads. */
function fakeContext(metadata: Record<string, unknown>) {
    return {
        env: { DB: {} as D1Database },
        get: (key: string) => (key === 'tenantId' ? TENANT : { sub: USER }),
        req: { header: () => '203.0.113.9' },
        get executionCtx(): never { throw new Error('no execution context'); },
        __metadata: metadata,
    } as unknown as Context<HonoConfig>;
}

describe('audit metadata never becomes a PII store', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        sqlite = fixture.sqlite;
        await setupSchema(sqlite);
        await testDb.insert(schema.tenants).values({
            id: TENANT, name: 'A', slug: 'a', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
    });

    afterEach(() => {
        sqlite.close();
        vi.clearAllMocks();
    });

    async function onlyAuditRow() {
        const rows = await testDb.select().from(schema.auditLogs).all();
        expect(rows).toHaveLength(1);
        return rows[0]!;
    }

    it('redacts contact details written through writeAuditLogWithSlug', async () => {
        await writeAuditLogWithSlug({} as D1Database, {
            tenantId: TENANT, actorUserId: USER,
            action: 'inspection.send_pdf', entityType: 'inspection', entityId: 'i1',
            metadata: { note: `called Jane Doe at ${SUBJECT} / 555-0142` },
        });
        const serialized = JSON.stringify((await onlyAuditRow()).metadata);
        expect(serialized).not.toContain(SUBJECT);
        expect(serialized).not.toContain('555-0142');
    });

    it('redacts contact details written through auditFromContext', async () => {
        // The SECOND insert site. A redactor on only one of them is the same
        // gap wearing a fix.
        auditFromContext(fakeContext({}), 'inspection.send_sms', 'inspection', {
            entityId: 'i1',
            metadata: { recipient: '+1 (512) 555-0142', agentEmail: SUBJECT, ip: '203.0.113.9' },
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
        const serialized = JSON.stringify((await onlyAuditRow()).metadata);
        expect(serialized).not.toContain(SUBJECT);
        expect(serialized).not.toContain('555-0142');
        expect(serialized).not.toContain('203.0.113.9');
    });

    it('catches an identifier under a key nobody named', async () => {
        // The point of filtering on the VALUE: a field added tomorrow is caught
        // because of what it holds, not because someone listed its name.
        await writeAuditLogWithSlug({} as D1Database, {
            tenantId: TENANT, action: 'inspection.share_agent', entityType: 'inspection',
            metadata: { someFutureField: SUBJECT },
        });
        expect(JSON.stringify((await onlyAuditRow()).metadata)).not.toContain(SUBJECT);
    });

    it('drops a property address, which has no detectable value shape', async () => {
        await writeAuditLogWithSlug({} as D1Database, {
            tenantId: TENANT, action: 'inspection.create', entityType: 'inspection',
            metadata: { propertyAddress: '123 Oak St, Austin TX' },
        });
        expect(JSON.stringify((await onlyAuditRow()).metadata)).not.toContain('Oak St');
    });

    it('keeps the structured event and the metadata that gives the row its value', async () => {
        // Redaction must not cost the thing the row exists for. `name` here is a
        // template, not a person, and `previousTokenHash` is the only durable
        // answer to "the customer says their old link stopped opening".
        await writeAuditLogWithSlug({} as D1Database, {
            tenantId: TENANT, action: 'portal_access.rotated', entityType: 'inspection', entityId: 'i1',
            metadata: { name: 'Standard Home Inspection', previousTokenHash: 'a3f1'.repeat(16), sectionCount: 12 },
        });
        const row = await onlyAuditRow();
        expect(row.action).toBe('portal_access.rotated');
        expect(row.entityType).toBe('inspection');
        expect(row.metadata).toEqual({
            name: 'Standard Home Inspection', previousTokenHash: 'a3f1'.repeat(16), sectionCount: 12,
        });
    });

    it('has an erasure rule for metadata', () => {
        const keys = new Set(ERASURE_MANIFEST.map((r) => `${r.table}.${r.column}`));
        expect(keys.has('audit_logs.metadata')).toBe(true);
    });

    it('scrubs historical metadata on an erasure, keeping the event', async () => {
        // Rows written before the redactor existed, and prose the redactor
        // cannot see, are the reason the manifest rule is the real guarantee.
        await testDb.insert(schema.contacts).values({
            id: 'c1', tenantId: TENANT, type: 'client', name: 'Jane Doe',
            email: SUBJECT, createdAt: new Date(),
        });
        await testDb.insert(schema.inspectionPeople).values({
            id: 'ip1', tenantId: TENANT, inspectionId: 'insp-1',
            contactId: 'c1', roleProfileId: 'rp1', createdAt: new Date(),
        });
        await testDb.insert(schema.auditLogs).values([
            {
                id: 'a1', tenantId: TENANT, action: 'inspection.create', entityType: 'inspection',
                entityId: 'insp-1', metadata: { note: 'legacy row: met Jane Doe at 123 Oak St' },
                ipAddress: '203.0.113.9', createdAt: new Date(),
            },
            {
                id: 'a2', tenantId: TENANT, action: 'template.create', entityType: 'template',
                entityId: 'tpl-9', metadata: { name: 'Standard' }, createdAt: new Date(),
            },
        ]);

        await runErasure(asAnyDb(testDb), { tenantId: TENANT, subjectEmail: SUBJECT, retentionYears: 6 });

        const rows = await testDb.select().from(schema.auditLogs).all();
        const subjectRow = rows.find((r) => r.id === 'a1')!;
        expect(subjectRow.metadata).toBeNull();
        expect(subjectRow.action).toBe('inspection.create');   // the event survives
        expect(subjectRow.entityId).toBe('insp-1');
        expect(subjectRow.ipAddress).toBe('203.0.113.9');      // staff security trail, out of scope
        // Unrelated rows are untouched.
        expect(rows.find((r) => r.id === 'a2')!.metadata).toEqual({ name: 'Standard' });
    });
});
