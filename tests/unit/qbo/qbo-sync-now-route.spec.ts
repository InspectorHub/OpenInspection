/**
 * "Sync now" must answer with what the check found, after it has finished.
 *
 * `POST /api/integrations/qbo/sync` used to hand the scan to `waitUntil` and
 * answer "started" at once, so the settings page re-read its status before the
 * scan had stored the time it last looked, and could not learn that the scan
 * had failed. These specs run the real service against real SQLite and a
 * stubbed Intuit, and assert the response and the row, not the calls made.
 *
 * Each refusal is paired with a positive control in the same file: the same
 * route, same company, answering 200 when QuickBooks is healthy.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import type { HonoConfig } from '../../../server/types/hono';
import { AppError } from '../../../server/lib/errors';
import { createTestDb, setupSchema } from '../db';

vi.mock('../../../server/lib/qbo-crypto', () => ({
    encryptToken: vi.fn(async (t: string) => `enc:${t}`),
    decryptToken: vi.fn(async (t: string) => t.replace('enc:', '')),
}));
vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
vi.mock('../../../server/lib/jwt-keyring', () => ({
    verifyJwt: vi.fn(async () => ({ sub: 'u1' })),
}));

import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { QBOService } from '../../../server/services/qbo.service';
import { InvoiceService } from '../../../server/services/invoice.service';
import qboRoutes from '../../../server/api/qbo';

const TENANT = '00000000-0000-0000-0000-000000000001';
const T0 = new Date('2026-03-01T10:00:00Z');
const LAST_SYNC_AT = new Date('2026-03-05T10:00:00Z');
const TOKEN_GOOD_UNTIL = new Date('2027-01-01T00:00:00Z');

let db: BetterSQLite3Database<typeof schema>;
let app: Hono<HonoConfig>;

const lastSyncAt = () => db.select().from(schema.qboConnections)
    .where(eq(schema.qboConnections.tenantId, TENANT)).get()!.lastSyncAt;

function stubIntuit(status: number, invoices: unknown[] = []) {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
        JSON.stringify(status === 200 ? { QueryResponse: invoices.length ? { Invoice: invoices } : {} } : { fault: {} }),
        { status, headers: { 'Content-Type': 'application/json' } },
    )));
}

const sync = () => app.request('/api/integrations/qbo/sync', {
    method: 'POST', headers: { Cookie: '__Host-inspector_token=stub' },
});

beforeEach(async () => {
    const fixture = createTestDb();
    db = fixture.db as unknown as BetterSQLite3Database<typeof schema>;
    await setupSchema(fixture.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    // The sweep paces itself between pages and apiCall backs off between retries.
    vi.stubGlobal('setTimeout', ((fn: () => void) => { fn(); return 0; }) as unknown as typeof setTimeout);

    await db.insert(schema.tenants).values({
        id: TENANT, slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: T0,
    });
    await db.insert(schema.qboConnections).values({
        tenantId: TENANT, realmId: 'realm-1', companyName: 'Sandbox Co',
        accessToken: 'enc:at', refreshToken: 'enc:rt',
        tokenExpiresAt: TOKEN_GOOD_UNTIL, refreshTokenExpiresAt: TOKEN_GOOD_UNTIL,
        syncEnabled: true, defaultItemId: '1', lastSyncAt: LAST_SYNC_AT, createdAt: T0,
    });

    const qbo = new QBOService({} as D1Database, 'cid', 'csec', 'whsec', 'a'.repeat(32), 'sandbox');
    const invoice = new InvoiceService({} as D1Database);
    app = new Hono<HonoConfig>();
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message, details: err.details } }, err.status as 409);
        }
        return c.json({ success: false }, 500);
    });
    app.use('*', async (c, next) => {
        c.set('tenantId', TENANT);
        c.set('userRole', 'owner');
        c.set('keyringPromise', Promise.resolve({} as never));
        c.set('user', { sub: 'u1' } as never);
        c.set('services', { qbo, invoice } as never);
        return next();
    });
    app.route('/api/integrations/qbo', qboRoutes);
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('POST /sync: a finished check', () => {
    it('answers with the count and the time, after last_sync_at has moved', async () => {
        stubIntuit(200);
        const before = Math.floor(Date.now() / 1000);

        const res = await sync();

        expect(res.status).toBe(200);
        const body = await res.json() as { success: boolean; data: { processed: number; checkedAt: number } };
        expect(body.success).toBe(true);
        expect(body.data.processed).toBe(0);
        expect(body.data.checkedAt).toBeGreaterThanOrEqual(before);
        // The stored time is already the new one when the response is read; it
        // was LAST_SYNC_AT (2026-03-05) a moment ago.
        const stored = lastSyncAt()!;
        expect(stored.getTime()).toBeGreaterThan(LAST_SYNC_AT.getTime());
        expect(Math.floor(stored.getTime() / 1000)).toBeLessThanOrEqual(body.data.checkedAt);
    });
});

describe('POST /sync: a check that did not finish', () => {
    it('reports an unreachable QuickBooks as a 503 and leaves the stored time alone', async () => {
        stubIntuit(500);

        const res = await sync();

        expect(res.status).toBe(503);
        const body = await res.json() as { success: boolean; error: { details: { reason: string } } };
        expect(body.success).toBe(false);
        expect(body.error.details.reason).toBe('qbo_unavailable');
        expect(lastSyncAt()!.getTime()).toBe(LAST_SYNC_AT.getTime());
    });

    it('is explicit when automatic sync is off, and does not ask QuickBooks anything', async () => {
        await db.update(schema.qboConnections).set({ syncEnabled: false })
            .where(eq(schema.qboConnections.tenantId, TENANT));
        stubIntuit(200);

        const res = await sync();

        expect(res.status).toBe(409);
        expect(((await res.json()) as { error: { details: { reason: string } } }).error.details.reason).toBe('qbo_sync_paused');
        expect(vi.mocked(fetch)).not.toHaveBeenCalled();
        expect(lastSyncAt()!.getTime()).toBe(LAST_SYNC_AT.getTime());
    });

    it('says not connected when there is no connection', async () => {
        await db.delete(schema.qboConnections).where(eq(schema.qboConnections.tenantId, TENANT));
        stubIntuit(200);

        const res = await sync();

        expect(res.status).toBe(409);
        expect(((await res.json()) as { error: { details: { reason: string } } }).error.details.reason).toBe('qbo_not_connected');
    });
});
