/**
 * Pointing a contact at an EXISTING QuickBooks customer by hand, and undoing it.
 *
 * The write is small and the ways it can go wrong are not. Each of them needs a
 * test that fails when the guard is removed, and each negative assertion is
 * paired with a positive control in the same block so a test that can never
 * pass cannot pass for the wrong reason:
 *
 *  - the contact id comes from a request, so a contact that belongs to another
 *    workspace (or is archived) has to read as "not found", not as a mapping
 *    row written into someone else's books;
 *  - an inactive QuickBooks customer is refused up front, because a mapping to
 *    it would fail on every later sync;
 *  - two admins can pick the same customer at once. The pre-check passes for
 *    both, so the loser must surface as a 409 from the unique key, not a 500,
 *    and must leave NOTHING behind (the mapping and the error resolution are one
 *    batch);
 *  - unlinking removes only this contact's row and is idempotent.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import { AppError } from '../../../server/lib/errors';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { QBOServiceBase } from '../../../server/services/qbo/api-base';
import { withConnection } from '../../../server/services/qbo/connection';
import { withCustomerSync } from '../../../server/services/qbo/customer-sync';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTHER = '00000000-0000-0000-0000-000000000002';
const ACTOR = 'user-owner-1';
const JWT_SECRET = 'unit-test-jwt-secret-0123456789ab';
const T0 = new Date('2026-03-01T10:00:00Z');

class TestQbo extends withCustomerSync(withConnection(QBOServiceBase)) {}

interface QboCustomerFixture { syncToken: string; displayName: string; active: boolean }

let db: BetterSQLite3Database<typeof schema>;
let sqliteDb: { exec: (sql: string) => unknown };
let svc: TestQbo;
let fetchMock: ReturnType<typeof vi.fn>;
let qboCustomers: Map<string, QboCustomerFixture>;
/** Runs once, on the next `GET customer/:id`, i.e. AFTER the holder pre-check. */
let beforeCustomerReply: (() => void) | null;

function qboHas(id: string, over: Partial<QboCustomerFixture> = {}) {
    qboCustomers.set(id, { syncToken: '0', displayName: `Customer ${id}`, active: true, ...over });
}

const mapRows = (tenantId: string) => db.select().from(schema.qboEntityMap)
    .where(eq(schema.qboEntityMap.tenantId, tenantId)).all();

const mapOf = (tenantId: string, contactId: string) => db.select().from(schema.qboEntityMap)
    .where(and(
        eq(schema.qboEntityMap.tenantId, tenantId),
        eq(schema.qboEntityMap.oiType, 'contact'),
        eq(schema.qboEntityMap.oiId, contactId),
    )).get();

const errorsOf = (tenantId: string) => db.select().from(schema.qboSyncErrors)
    .where(eq(schema.qboSyncErrors.tenantId, tenantId)).all();

const auditRows = () => db.select().from(schema.auditLogs).all();

const contactErrorRow = (id: string, tenantId: string, oiId: string, resolved = false) => ({
    id, tenantId, oiType: 'contact', oiId,
    errorCode: 'SYNC_ERROR', errorMsg: 'QBO 400', retries: 1, resolved,
    createdAt: T0, updatedAt: T0,
});

async function thrownBy(run: () => Promise<unknown>): Promise<AppError> {
    try {
        await run();
    } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        return err as AppError;
    }
    throw new Error('expected the call to throw');
}

beforeEach(async () => {
    const fixture = createTestDb();
    db = fixture.db as unknown as BetterSQLite3Database<typeof schema>;
    await setupSchema(fixture.sqlite);
    sqliteDb = fixture.sqlite;
    // The better-sqlite3 driver has no `batch`; D1 does, and it is atomic. This
    // stand-in gives the same all-or-nothing behaviour so the rollback is real.
    (db as unknown as { batch: (stmts: Array<{ run: () => unknown }>) => Promise<unknown[]> }).batch = async (stmts) => {
        fixture.sqlite.exec('BEGIN');
        try {
            const out = stmts.map((s) => s.run());
            fixture.sqlite.exec('COMMIT');
            return out;
        } catch (err) {
            fixture.sqlite.exec('ROLLBACK');
            throw err;
        }
    };
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

    qboCustomers = new Map();
    beforeCustomerReply = null;
    fetchMock = vi.fn(async (input: unknown) => {
        const customerId = /\/customer\/([^?]+)/.exec(String(input))?.[1];
        if (customerId) {
            const hook = beforeCustomerReply;
            beforeCustomerReply = null;
            hook?.();
            const c = qboCustomers.get(customerId);
            if (!c) return new Response('{"Fault":{}}', { status: 404 });
            return new Response(JSON.stringify({
                Customer: { Id: customerId, SyncToken: c.syncToken, DisplayName: c.displayName, Active: c.active },
            }), { status: 200 });
        }
        return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    svc = new TestQbo({} as D1Database, 'cid', 'csec', 'whsec', JWT_SECRET, 'sandbox');

    for (const [id, slug] of [[TENANT, 'acme'], [OTHER, 'other']] as const) {
        await db.insert(schema.tenants).values({
            id, slug, status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: T0,
        });
        await svc.saveConnection({
            tenantId: id, realmId: `realm-${slug}`, companyName: 'Books',
            accessToken: 'access-plain', refreshToken: 'refresh-plain', refreshTokenExpiresIn: 8_726_400,
        });
    }
    const contact = (id: string, tenantId: string, name: string, extra: Record<string, unknown> = {}) =>
        db.insert(schema.contacts).values({
            id, tenantId, type: 'client', name, email: `${id}@example.com`, createdAt: T0, ...extra,
        } as never);
    await contact('contact-1', TENANT, 'Alice Adams');
    await contact('contact-2', TENANT, 'Bob Brown');
    await contact('contact-archived', TENANT, 'Old Contact', { archivedAt: T0 });
    await contact('contact-foreign', OTHER, 'Foreign Person');
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('linkExistingCustomer only touches a live contact of this workspace', () => {
    it('treats another workspace\'s contact as not found, and writes nothing', async () => {
        qboHas('58');

        const err = await thrownBy(() => svc.linkExistingCustomer(TENANT, 'contact-foreign', '58', ACTOR));

        expect(err.status).toBe(404);
        expect(mapRows(TENANT)).toHaveLength(0);
        expect(mapRows(OTHER)).toHaveLength(0);
        // It must not even ask QuickBooks: the existence of the contact is
        // decided before any outbound call.
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('links a contact of this workspace (positive control for the refusal above)', async () => {
        qboHas('58');

        await svc.linkExistingCustomer(TENANT, 'contact-1', '58', ACTOR);

        expect(mapOf(TENANT, 'contact-1')?.qboId).toBe('58');
    });

    it('treats an archived contact as not found', async () => {
        qboHas('58');

        const err = await thrownBy(() => svc.linkExistingCustomer(TENANT, 'contact-archived', '58', ACTOR));

        expect(err.status).toBe(404);
        expect(mapRows(TENANT)).toHaveLength(0);
    });

    it('a contact id that does not exist at all is also not found', async () => {
        qboHas('58');

        const err = await thrownBy(() => svc.linkExistingCustomer(TENANT, 'no-such-contact', '58', ACTOR));

        expect(err.status).toBe(404);
    });
});

describe('linkExistingCustomer refuses an inactive QuickBooks customer', () => {
    it('answers 400 with a stable reason and writes no mapping', async () => {
        qboHas('58', { active: false });

        const err = await thrownBy(() => svc.linkExistingCustomer(TENANT, 'contact-1', '58', ACTOR));

        expect(err.status).toBe(400);
        expect(err.details).toMatchObject({ reason: 'qbo_customer_inactive' });
        expect(mapRows(TENANT)).toHaveLength(0);
    });

    it('links the same customer once it is active (positive control)', async () => {
        qboHas('58', { active: true });

        await svc.linkExistingCustomer(TENANT, 'contact-1', '58', ACTOR);

        expect(mapOf(TENANT, 'contact-1')?.qboId).toBe('58');
    });
});

describe('linkExistingCustomer when another contact already holds the customer', () => {
    it('answers 409 and names the holder', async () => {
        qboHas('58');
        await svc.linkExistingCustomer(TENANT, 'contact-1', '58', ACTOR);

        const err = await thrownBy(() => svc.linkExistingCustomer(TENANT, 'contact-2', '58', ACTOR));

        expect(err.status).toBe(409);
        expect(err.details).toMatchObject({
            reason: 'qbo_customer_taken', holderContactId: 'contact-1', holderName: 'Alice Adams',
        });
        expect(mapRows(TENANT)).toHaveLength(1);
    });

    it('is idempotent for the contact that already holds it (positive control)', async () => {
        qboHas('58');
        await svc.linkExistingCustomer(TENANT, 'contact-1', '58', ACTOR);

        const again = await svc.linkExistingCustomer(TENANT, 'contact-1', '58', ACTOR);

        expect(again.qboCustomerId).toBe('58');
        // Pointing at the same customer again replaces nothing.
        expect(again.replacedQboCustomerId).toBeNull();
        expect(mapRows(TENANT)).toHaveLength(1);
    });

    it('answers 409, not 500, when a racing link wins after the pre-check passed, and leaves nothing half-applied', async () => {
        qboHas('58');
        await db.insert(schema.qboSyncErrors).values(contactErrorRow('err-1', TENANT, 'contact-2'));
        // The other admin's link lands between our pre-check and our write.
        beforeCustomerReply = () => {
            db.insert(schema.qboEntityMap).values({
                id: 'racer', tenantId: TENANT, oiType: 'contact', oiId: 'contact-1',
                qboType: 'Customer', qboId: '58', qboSyncToken: '0', syncedAt: T0,
            }).run();
        };

        const err = await thrownBy(() => svc.linkExistingCustomer(TENANT, 'contact-2', '58', ACTOR));

        expect(err.status).toBe(409);
        expect(err.details).toMatchObject({ reason: 'qbo_customer_taken', holderContactId: 'contact-1' });
        // Only the racer's row; ours rolled back with the error resolution.
        expect(mapRows(TENANT).map((r) => r.id)).toEqual(['racer']);
        expect(errorsOf(TENANT)[0]?.resolved).toBe(false);
        expect(auditRows()).toHaveLength(0);
    });
});

describe('linkExistingCustomer tells the caller what went wrong with QuickBooks', () => {
    const apiCallSpy = () => vi.spyOn(
        svc as unknown as { apiCall: (...args: unknown[]) => Promise<unknown> }, 'apiCall',
    );

    it('answers a customer that does not exist with a 400 naming it, not a 500', async () => {
        // qboCustomers is empty, so the fixture answers 404 for id 99.
        const err = await thrownBy(() => svc.linkExistingCustomer(TENANT, 'contact-1', '99', ACTOR));

        expect(err.status).toBe(400);
        expect(err.details).toMatchObject({ reason: 'qbo_customer_not_found' });
        expect(mapRows(TENANT)).toHaveLength(0);
    });

    it('answers the 400 (fault 610) Intuit sends for a missing object the same way', async () => {
        fetchMock.mockImplementation(async (input: unknown) =>
            /\/customer\//.test(String(input)) ? new Response('{"Fault":{}}', { status: 400 }) : new Response('{}', { status: 200 }));

        const err = await thrownBy(() => svc.linkExistingCustomer(TENANT, 'contact-1', '99', ACTOR));

        expect(err.details).toMatchObject({ reason: 'qbo_customer_not_found' });
    });

    it('answers a tenant with no connection with a 409 that says to connect', async () => {
        sqliteDb.exec(`DELETE FROM qbo_connections WHERE tenant_id = '${TENANT}'`);

        const err = await thrownBy(() => svc.linkExistingCustomer(TENANT, 'contact-1', '58', ACTOR));

        expect(err.status).toBe(409);
        expect(err.details).toMatchObject({ reason: 'qbo_not_connected' });
    });

    it.each([
        ['a rejected refresh token', new Error('QBO refresh token rejected — reconnect required'), 409, 'qbo_not_connected'],
        ['a 401 from QuickBooks', Object.assign(new Error('QBO 401'), { status: 401 }), 409, 'qbo_not_connected'],
        ['a 429 after the retries', Object.assign(new Error('QBO 429'), { status: 429 }), 503, 'qbo_unavailable'],
        ['a 500 after the retries', Object.assign(new Error('QBO 500'), { status: 500 }), 503, 'qbo_unavailable'],
    ])('maps %s to the documented answer', async (_label, failure, status, reason) => {
        apiCallSpy().mockRejectedValue(failure);

        const err = await thrownBy(() => svc.linkExistingCustomer(TENANT, 'contact-1', '58', ACTOR));

        expect(err.status).toBe(status);
        expect(err.details).toMatchObject({ reason });
    });

    it('does not hide an error it does not recognise as one of the four', async () => {
        apiCallSpy().mockRejectedValue(new TypeError('unexpected'));

        await expect(svc.linkExistingCustomer(TENANT, 'contact-1', '58', ACTOR)).rejects.toThrow('unexpected');
    });
});

describe('linkExistingCustomer applies the mapping and the error resolution together', () => {
    it('rolls the mapping back when the second statement of the batch fails', async () => {
        qboHas('58');
        await db.insert(schema.qboSyncErrors).values(contactErrorRow('err-1', TENANT, 'contact-2'));
        // The mapping insert runs first and succeeds; closing the error then
        // fails. Without a real transaction the insert would stay behind.
        sqliteDb.exec(`CREATE TRIGGER fail_error_update BEFORE UPDATE ON qbo_sync_errors
            BEGIN SELECT RAISE(ABORT, 'forced failure'); END`);

        await expect(svc.linkExistingCustomer(TENANT, 'contact-2', '58', ACTOR)).rejects.toThrow();

        expect(mapRows(TENANT)).toHaveLength(0);
        expect(errorsOf(TENANT)[0]?.resolved).toBe(false);
    });

    it('applies both when nothing fails (positive control for the rollback above)', async () => {
        qboHas('58');
        await db.insert(schema.qboSyncErrors).values(contactErrorRow('err-1', TENANT, 'contact-2'));

        await svc.linkExistingCustomer(TENANT, 'contact-2', '58', ACTOR);

        expect(mapRows(TENANT)).toHaveLength(1);
        expect(errorsOf(TENANT)[0]?.resolved).toBe(true);
    });

    it('still links when the audit row cannot be written', async () => {
        qboHas('58');
        sqliteDb.exec(`CREATE TRIGGER fail_audit BEFORE INSERT ON audit_logs
            BEGIN SELECT RAISE(ABORT, 'audit down'); END`);

        const result = await svc.linkExistingCustomer(TENANT, 'contact-1', '58', ACTOR);

        expect(result.qboCustomerId).toBe('58');
        expect(mapOf(TENANT, 'contact-1')?.qboId).toBe('58');
    });
});

describe('linkExistingCustomer records what it did', () => {
    it('stores the display name QuickBooks reported as a snapshot', async () => {
        qboHas('58', { displayName: 'Adams Family Trust', syncToken: '3' });

        const result = await svc.linkExistingCustomer(TENANT, 'contact-1', '58', ACTOR);

        expect(mapOf(TENANT, 'contact-1')).toMatchObject({
            qboId: '58', qboSyncToken: '3', qboDisplayName: 'Adams Family Trust',
        });
        expect(result).toEqual({
            qboCustomerId: '58', displayName: 'Adams Family Trust',
            replacedQboCustomerId: null, resolvedErrorCount: 0,
        });
    });

    it('re-points a contact: the row follows the new customer and the old id is reported', async () => {
        qboHas('58', { syncToken: '1' });
        qboHas('59', { syncToken: '4', displayName: 'Second Customer' });
        await svc.linkExistingCustomer(TENANT, 'contact-1', '58', ACTOR);

        const result = await svc.linkExistingCustomer(TENANT, 'contact-1', '59', ACTOR);

        expect(result.replacedQboCustomerId).toBe('58');
        expect(mapRows(TENANT)).toHaveLength(1);
        expect(mapOf(TENANT, 'contact-1')).toMatchObject({
            qboId: '59', qboSyncToken: '4', qboDisplayName: 'Second Customer',
        });
    });

    it('resolves this contact\'s open sync errors in the same step, and only those', async () => {
        qboHas('58');
        await db.insert(schema.qboSyncErrors).values([
            contactErrorRow('err-a', TENANT, 'contact-1'),
            { ...contactErrorRow('err-b', TENANT, 'contact-1'), errorCode: 'OTHER_CODE' },
            contactErrorRow('err-other-contact', TENANT, 'contact-2'),
            contactErrorRow('err-already', TENANT, 'contact-1', true),
            { ...contactErrorRow('err-invoice', TENANT, 'contact-1'), oiType: 'invoice' },
            contactErrorRow('err-foreign-tenant', OTHER, 'contact-1'),
        ]);

        const result = await svc.linkExistingCustomer(TENANT, 'contact-1', '58', ACTOR);

        const state = (id: string) => db.select().from(schema.qboSyncErrors)
            .where(eq(schema.qboSyncErrors.id, id)).get()!;
        expect(result.resolvedErrorCount).toBe(2);
        expect(state('err-a').resolved).toBe(true);
        expect(state('err-a').resolvedAt).toBeInstanceOf(Date);
        expect(state('err-b').resolved).toBe(true);
        // Everything that is not "an open contact error of this contact in this
        // workspace" stays exactly as it was.
        expect(state('err-other-contact').resolved).toBe(false);
        expect(state('err-invoice').resolved).toBe(false);
        expect(state('err-foreign-tenant').resolved).toBe(false);
        expect(state('err-already').resolvedAt).toBeNull();
    });

    it('writes an audit row without any token, and none when the link fails', async () => {
        qboHas('58');
        qboHas('59');
        await svc.linkExistingCustomer(TENANT, 'contact-1', '58', ACTOR);
        await svc.linkExistingCustomer(TENANT, 'contact-1', '59', ACTOR);
        // A refused link records nothing: the inactive customer below.
        qboHas('60', { active: false });
        await thrownBy(() => svc.linkExistingCustomer(TENANT, 'contact-2', '60', ACTOR));

        const rows = auditRows().filter((r) => r.action === 'qbo.customer.linked');
        expect(rows).toHaveLength(2);
        expect(rows[1]).toMatchObject({
            tenantId: TENANT, userId: ACTOR, entityType: 'contact', entityId: 'contact-1',
        });
        expect(rows[1]!.metadata).toMatchObject({
            contactId: 'contact-1', qboCustomerId: '59', replacedQboCustomerId: '58',
        });
        const serialized = JSON.stringify(rows);
        expect(serialized).not.toMatch(/access-plain|refresh-plain|SyncToken/i);
        expect(auditRows()).toHaveLength(2);
    });
});

describe('unlinkCustomer', () => {
    it('removes only this contact\'s mapping and reports it', async () => {
        qboHas('58');
        qboHas('59');
        await svc.linkExistingCustomer(TENANT, 'contact-1', '58', ACTOR);
        await svc.linkExistingCustomer(TENANT, 'contact-2', '59', ACTOR);

        const result = await svc.unlinkCustomer(TENANT, 'contact-1', ACTOR);

        expect(result).toEqual({ removed: true });
        expect(mapOf(TENANT, 'contact-1')).toBeUndefined();
        // Positive control: the sibling mapping is untouched.
        expect(mapOf(TENANT, 'contact-2')?.qboId).toBe('59');
    });

    it('is idempotent: unlinking again removes nothing and does not throw', async () => {
        qboHas('58');
        await svc.linkExistingCustomer(TENANT, 'contact-1', '58', ACTOR);
        await svc.unlinkCustomer(TENANT, 'contact-1', ACTOR);

        await expect(svc.unlinkCustomer(TENANT, 'contact-1', ACTOR)).resolves.toEqual({ removed: false });
    });

    it('audits an actual removal, not a no-op', async () => {
        qboHas('58');
        await svc.linkExistingCustomer(TENANT, 'contact-1', '58', ACTOR);
        await svc.unlinkCustomer(TENANT, 'contact-1', ACTOR);
        await svc.unlinkCustomer(TENANT, 'contact-1', ACTOR);

        const rows = auditRows().filter((r) => r.action === 'qbo.customer.unlinked');
        expect(rows).toHaveLength(1);
        expect(rows[0]!.metadata).toMatchObject({ contactId: 'contact-1', qboCustomerId: '58' });
    });

    it('treats another workspace\'s contact as not found and leaves its mapping alone', async () => {
        qboHas('58');
        await svc.linkExistingCustomer(OTHER, 'contact-foreign', '58', ACTOR);

        const err = await thrownBy(() => svc.unlinkCustomer(TENANT, 'contact-foreign', ACTOR));

        expect(err.status).toBe(404);
        expect(mapOf(OTHER, 'contact-foreign')?.qboId).toBe('58');
    });
});

describe('getContactLink', () => {
    it('reports an unlinked contact', async () => {
        await expect(svc.getContactLink(TENANT, 'contact-1')).resolves.toEqual({
            linked: false, qboCustomerId: null, displayName: null, openErrorCount: 0,
        });
    });

    it('reports a linked contact with its snapshot name and this contact\'s open errors only', async () => {
        qboHas('58', { displayName: 'Adams Family Trust' });
        await svc.linkExistingCustomer(TENANT, 'contact-1', '58', ACTOR);
        await db.insert(schema.qboSyncErrors).values([
            contactErrorRow('err-1', TENANT, 'contact-1'),
            { ...contactErrorRow('err-2', TENANT, 'contact-1'), errorCode: 'OTHER_CODE' },
            contactErrorRow('err-resolved', TENANT, 'contact-1', true),
            contactErrorRow('err-other', TENANT, 'contact-2'),
        ]);

        await expect(svc.getContactLink(TENANT, 'contact-1')).resolves.toEqual({
            linked: true, qboCustomerId: '58', displayName: 'Adams Family Trust', openErrorCount: 2,
        });
    });

    it('reports a null name for a row the automatic sync created', async () => {
        await db.insert(schema.qboEntityMap).values({
            id: 'auto', tenantId: TENANT, oiType: 'contact', oiId: 'contact-1',
            qboType: 'Customer', qboId: '77', qboSyncToken: '0', syncedAt: T0,
        });

        await expect(svc.getContactLink(TENANT, 'contact-1')).resolves.toMatchObject({
            linked: true, qboCustomerId: '77', displayName: null,
        });
    });

    it('treats another workspace\'s contact as not found', async () => {
        const err = await thrownBy(() => svc.getContactLink(TENANT, 'contact-foreign'));

        expect(err.status).toBe(404);
    });
});

describe('upsertCustomer with no QuickBooks connection', () => {
    const PAT = { id: 'contact-1', name: 'Alice Adams', email: 'contact-1@example.com', phone: null, agency: null };

    it('returns without calling QuickBooks and without recording a sync error', async () => {
        await db.delete(schema.qboConnections).where(eq(schema.qboConnections.tenantId, TENANT));

        await svc.upsertCustomer(TENANT, PAT);

        expect(fetchMock).not.toHaveBeenCalled();
        expect(errorsOf(TENANT)).toHaveLength(0);
    });

    it('still records a sync error when a connection exists and QuickBooks refuses (positive control)', async () => {
        fetchMock.mockImplementation(async () => new Response('{"Fault":{"Error":[{"code":"2010"}]}}', { status: 400 }));

        await svc.upsertCustomer(TENANT, PAT);

        expect(errorsOf(TENANT)).toHaveLength(1);
        expect(errorsOf(TENANT)[0]).toMatchObject({ oiType: 'contact', oiId: 'contact-1' });
    });
});
