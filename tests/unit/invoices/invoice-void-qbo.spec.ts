/**
 * Task 9 (Issue #182) — voidInvoice QBO propagation.
 *
 * Locks in `QBOService.voidInvoice` behaviour against an in-memory SQLite DB:
 *  - Mapped invoice  → POST invoice?operation=void fires with correct Id/SyncToken.
 *  - Unmapped invoice → no-op (apiCall is never called, no throw).
 *  - QBO API error   → voidInvoice resolves (OI consistency preserved; error is swallowed).
 *
 * Mocking approach: `drizzle-orm/d1` is replaced with a vi.fn() so that
 * `getDrizzle()` (which calls `drizzle(this.db)`) returns the real better-sqlite3
 * drizzle instance created by `createTestDb()`.  `apiCall` is spied on via
 * `vi.spyOn` on the instance — this is the lowest-level mock that is still
 * discriminating: the test fails if the POST is not issued or is issued with
 * the wrong arguments.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

// Must mock before importing any server module that imports drizzle-orm/d1.
vi.mock('../../../server/lib/qbo-crypto', () => ({
    encryptToken: vi.fn(async (text: string) => `enc:${text}`),
    decryptToken: vi.fn(async (text: string) => text.replace('enc:', '')),
}));

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { QBOServiceBase } from '../../../server/services/qbo/api-base';
import { withInvoiceSync } from '../../../server/services/qbo/invoice-sync';

// Minimal composed class — only the mixin under test, no other layers.
class TestQBOService extends withInvoiceSync(QBOServiceBase) {}

const TENANT = '00000000-0000-0000-0000-000000000001';
const INV_ID = 'inv-aaaaaaaa-0000-0000-0000-000000000001';
const MAP_ID = 'map-bbbbbbbb-0000-0000-0000-000000000001';
const QBO_ID = '147';
const QBO_SYNC_TOKEN = '3';

let db: BetterSQLite3Database<typeof schema>;
let svc: TestQBOService;

beforeEach(async () => {
    const fixture = createTestDb();
    db = fixture.db;
    await setupSchema(fixture.sqlite);

    // Wire getDrizzle() → the in-memory SQLite instance.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db as any);

    svc = new TestQBOService({} as D1Database, 'cid', 'csec', 'whsec', 'secret32chars_aaaaaaaaaaaaaaaa');

    // Seed a tenant row (required by any FK-adjacent query).
    await db.insert(schema.tenants).values({
        id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
});

// ---------------------------------------------------------------------------
// Helper: seed a qboEntityMap row linking the OI invoice to a QBO invoice.
// ---------------------------------------------------------------------------
async function seedMapping() {
    await db.insert(schema.qboEntityMap).values({
        id:           MAP_ID,
        tenantId:     TENANT,
        oiType:       'invoice',
        oiId:         INV_ID,
        qboType:      'Invoice',
        qboId:        QBO_ID,
        qboSyncToken: QBO_SYNC_TOKEN,
        syncedAt:     Math.floor(Date.now() / 1000),
    });
}

// ---------------------------------------------------------------------------

describe('voidInvoice — mapped invoice', () => {
    it('calls apiCall with POST, invoice?operation=void, and the correct QBO Id / SyncToken', async () => {
        await seedMapping();

        // Spy on apiCall BEFORE calling voidInvoice.
        const apiCallSpy = vi.spyOn(svc as never, 'apiCall').mockResolvedValue({
            Invoice: { Id: QBO_ID, SyncToken: '4' },
        });

        await svc.voidInvoice(TENANT, INV_ID);

        expect(apiCallSpy).toHaveBeenCalledOnce();
        const [calledTenant, calledMethod, calledPath, calledBody] = apiCallSpy.mock.calls[0] as [
            string, string, string, { Id: string; SyncToken: string }
        ];
        expect(calledTenant).toBe(TENANT);
        expect(calledMethod).toBe('POST');
        expect(calledPath).toContain('invoice?operation=void');
        expect(calledBody).toMatchObject({ Id: QBO_ID, SyncToken: QBO_SYNC_TOKEN });
    });

    it('updates qboSyncToken in qboEntityMap after a successful void', async () => {
        await seedMapping();

        vi.spyOn(svc as never, 'apiCall').mockResolvedValue({
            Invoice: { Id: QBO_ID, SyncToken: '99' },
        });

        await svc.voidInvoice(TENANT, INV_ID);

        const updated = await db.select().from(schema.qboEntityMap)
            .where(eq(schema.qboEntityMap.id, MAP_ID)).get();
        expect(updated?.qboSyncToken).toBe('99');
    });
});

describe('voidInvoice — unmapped invoice', () => {
    it('returns without calling apiCall when no qboEntityMap row exists', async () => {
        // No seedMapping() call — no row in DB.
        const apiCallSpy = vi.spyOn(svc as never, 'apiCall');

        await expect(svc.voidInvoice(TENANT, INV_ID)).resolves.toBeUndefined();
        expect(apiCallSpy).not.toHaveBeenCalled();
    });
});

describe('voidInvoice — QBO API error swallowed', () => {
    it('resolves (does not throw) when apiCall rejects, preserving OI consistency', async () => {
        await seedMapping();

        vi.spyOn(svc as never, 'apiCall').mockRejectedValue(
            Object.assign(new Error('QBO 500'), { status: 500 }),
        );

        // The key guarantee: OI void always succeeds even if QBO is down.
        await expect(svc.voidInvoice(TENANT, INV_ID)).resolves.toBeUndefined();
    });

    it('writes a qboSyncErrors row when apiCall rejects', async () => {
        await seedMapping();

        vi.spyOn(svc as never, 'apiCall').mockRejectedValue(new Error('QBO 503'));

        await svc.voidInvoice(TENANT, INV_ID);

        const errors = await db.select().from(schema.qboSyncErrors).all();
        expect(errors).toHaveLength(1);
        expect(errors[0]?.oiType).toBe('invoice');
        expect(errors[0]?.oiId).toBe(INV_ID);
    });
});
