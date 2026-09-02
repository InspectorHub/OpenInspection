/**
 * One QuickBooks company belongs to one workspace, and the webhook depends on it.
 *
 * `POST /webhooks/quickbooks` is unauthenticated and platform-wide:
 * in SaaS the Intuit app belongs to the platform (`qboAppManaged`), so there is
 * ONE webhook URL and ONE verifier token for every realm. Nothing in the URL
 * says which tenant an event is for — the handler verifies the HMAC and then
 * looks the tenant up by the realm id inside the verified body. That lookup is
 * the whole of the tenant decision.
 *
 * `qbo_connections.realm_id` is a plain `notNull` column: `tenant_id` is the
 * primary key, so the table permits two tenants to hold the SAME realm. When
 * they do, the lookup picks one arbitrarily and every event for that company —
 * payments, voids, balance changes — is applied to whichever row SQLite handed
 * back. That is a cross-tenant write chosen by row order.
 *
 * Both ends are closed here, in the application layer, which is where this repo
 * enforces referential integrity (see the Schema Rules in CLAUDE.md — D1 cannot
 * rebuild a table cheaply, so constraints live in code):
 *
 *   - the WRITE refuses to bind a realm another tenant already holds, so a
 *     second claim cannot be created through the product;
 *   - the READ refuses to guess when more than one row matches, so any
 *     duplicate that already exists in a database is skipped and counted
 *     instead of being resolved to an arbitrary tenant.
 *
 * The read-side guard is deliberately not made redundant by the write-side one.
 * A duplicate predating this change would otherwise keep silently working.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import * as schema from '../../../server/lib/db/schema';
import { logger } from '../../../server/lib/logger';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('../../../server/lib/qbo-crypto', () => ({
    encryptToken: vi.fn(async (t: string) => `enc:${t}`),
    decryptToken: vi.fn(async (t: string) => t.replace('enc:', '')),
}));
vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { QBOService } from '../../../server/services/qbo.service';
import { QBOCloudEventSchema, type QBOCloudEvent } from '../../../server/lib/validations/qbo.schema';
import { AppError } from '../../../server/lib/errors';

const TENANT_A = '00000000-0000-0000-0000-00000000000a';
const TENANT_B = '00000000-0000-0000-0000-00000000000b';
const REALM = '9130350000000000';
const QBO_ID = '147';
const WEBHOOK_SECRET = 'intuit-verifier-token';
const T0 = new Date('2026-03-01T10:00:00Z');
const TOKEN_GOOD_UNTIL = new Date('2027-01-01T00:00:00Z');

let db: BetterSQLite3Database<typeof schema>;
let sqlite: InstanceType<typeof import('better-sqlite3')>;
let qbo: QBOService;
let warnSpy: ReturnType<typeof vi.spyOn>;
let fetchCalls: string[];

const sign = (rawBody: string) =>
    createHmac('sha256', WEBHOOK_SECRET).update(rawBody, 'utf8').digest('base64');

function cloudEvent(over: Record<string, unknown> = {}): QBOCloudEvent {
    return QBOCloudEventSchema.parse({
        specversion: '1.0',
        id: 'a1b2c3d4-0000-4000-8000-000000000001',
        source: '/services/quickbooks/v3',
        type: 'qbo.invoice.updated.v1',
        datacontenttype: 'application/json',
        time: '2026-03-05T10:00:00Z',
        intuitentityid: QBO_ID,
        intuitaccountid: REALM,
        data: { name: 'Invoice', operation: 'Update' },
        ...over,
    });
}

async function seedTenant(id: string, slug: string) {
    await db.insert(schema.tenants).values({
        id, slug, status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: T0,
    });
}

async function seedConnection(tenantId: string, realmId: string) {
    await db.insert(schema.qboConnections).values({
        tenantId, realmId, companyName: 'Sandbox Co',
        accessToken: 'enc:at', refreshToken: 'enc:rt',
        tokenExpiresAt: TOKEN_GOOD_UNTIL, refreshTokenExpiresAt: TOKEN_GOOD_UNTIL,
        syncEnabled: true, defaultItemId: '1', createdAt: T0,
    });
}

beforeEach(async () => {
    const fixture = createTestDb();
    db = fixture.db as unknown as BetterSQLite3Database<typeof schema>;
    sqlite = fixture.sqlite;
    await setupSchema(fixture.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    fetchCalls = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
        fetchCalls.push(new URL(String(input)).pathname);
        return new Response(
            JSON.stringify({ Invoice: { Id: QBO_ID, SyncToken: '9', Balance: 0, TotalAmt: 450 } }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
    }));

    qbo = new QBOService({} as D1Database, 'cid', 'csec', WEBHOOK_SECRET, 'a'.repeat(32), 'sandbox');
    await seedTenant(TENANT_A, 'acme');
    await seedTenant(TENANT_B, 'beta');
});

afterEach(() => { vi.unstubAllGlobals(); warnSpy.mockRestore(); });

/**
 * Reproduces the state a database can be in that the unique index now
 * forbids — a workspace that already held a duplicate when the constraint
 * landed. The index is dropped for the duration so the rows can exist at all;
 * that IS the scenario, and it is why the read-side refusal is not redundant
 * with the write-side one.
 */
async function seedDuplicateClaim() {
    sqlite.exec('DROP INDEX IF EXISTS uq_qbo_connections_realm;');
    await seedConnection(TENANT_A, REALM);
    await seedConnection(TENANT_B, REALM);
}

const deliver = (payload: unknown) => {
    const rawBody = JSON.stringify(payload);
    return qbo.handleWebhook(rawBody, sign(rawBody), vi.fn() as never, vi.fn() as never);
};

describe('connecting a realm another tenant already holds', () => {
    it('is refused, and the incumbent keeps the connection', async () => {
        await seedConnection(TENANT_A, REALM);

        const err = await qbo.saveConnection({
            tenantId: TENANT_B,
            realmId: REALM,
            companyName: 'Sandbox Co',
            accessToken: 'at-b',
            refreshToken: 'rt-b',
            refreshTokenExpiresIn: 8_726_400,
        }).then(() => null, (e: unknown) => e);

        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).status).toBe(409);

        const rows = await db.select().from(schema.qboConnections).all();
        expect(rows).toHaveLength(1);
        expect(rows[0]!.tenantId).toBe(TENANT_A);
    });

    it('positive control — the SAME tenant may reconnect the same realm', async () => {
        await seedConnection(TENANT_A, REALM);

        await qbo.saveConnection({
            tenantId: TENANT_A,
            realmId: REALM,
            companyName: 'Sandbox Co Renamed',
            accessToken: 'at-fresh',
            refreshToken: 'rt-fresh',
            refreshTokenExpiresIn: 8_726_400,
        });

        const row = await db.select().from(schema.qboConnections)
            .where(eq(schema.qboConnections.tenantId, TENANT_A)).get();
        expect(row!.companyName).toBe('Sandbox Co Renamed');
        expect(row!.accessToken).toBe('enc:at-fresh');
    });

    it('positive control — a DIFFERENT realm connects normally', async () => {
        await seedConnection(TENANT_A, REALM);

        await qbo.saveConnection({
            tenantId: TENANT_B,
            realmId: '4620816365000000',
            companyName: 'Other Co',
            accessToken: 'at-b',
            refreshToken: 'rt-b',
            refreshTokenExpiresIn: 8_726_400,
        });

        const rows = await db.select().from(schema.qboConnections).all();
        expect(rows).toHaveLength(2);
    });
});

describe('a webhook for a realm two tenants hold', () => {
    it('applies the event to NEITHER of them', async () => {
        await seedDuplicateClaim();

        const result = await deliver(cloudEvent());

        expect(result).toEqual({ valid: true });   // Intuit must not be made to retry
        // Nothing was fetched from QuickBooks, so nothing could have been
        // applied to either tenant's books.
        expect(fetchCalls).toEqual([]);
    });

    it('says so, naming the realm and how many tenants claim it', async () => {
        await seedDuplicateClaim();

        await deliver(cloudEvent());

        expect(warnSpy).toHaveBeenCalled();
        const payloads = warnSpy.mock.calls
            .map((call: unknown[]) => `${String(call[0])} ${JSON.stringify(call[1])}`)
            .join('\n');
        expect(payloads).toContain(REALM);
        expect(payloads).toMatch(/ambiguous/i);
    });

    it('positive control — one claimant still resolves and is applied', async () => {
        await seedConnection(TENANT_A, REALM);

        await deliver(cloudEvent());

        expect(fetchCalls).toEqual([`/v3/company/${REALM}/invoice/${QBO_ID}`]);
    });
});
