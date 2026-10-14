/**
 * What the settings page can read about a connection without calling Intuit:
 * which environment it is pointed at, when it was made, and how much has been
 * matched so far.
 *
 * The counts matter because disconnecting empties `qbo_entity_map`, and the
 * confirmation has to say how much the next sync will have to rediscover. They
 * are scoped by tenant and by `oi_type`; a refund twin is neither a customer
 * nor an invoice, and another company's rows are not this company's progress.
 *
 * `environment` must be able to say "not set". The API host is a deployment
 * decision with no default (see `resolveQboApiBase`), so a status that guessed
 * `sandbox` would put a reassuring badge on a connection that cannot make a
 * single call.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { QBOServiceBase } from '../../../server/services/qbo/api-base';
import { withConnection } from '../../../server/services/qbo/connection';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTHER = '00000000-0000-0000-0000-000000000002';
const JWT_SECRET = 'unit-test-jwt-secret-0123456789ab';

const CONNECTED_AT = new Date('2026-03-01T10:00:00Z');
const ACCESS_EXPIRES_AT = new Date('2026-03-01T11:00:00Z');

class TestQbo extends withConnection(QBOServiceBase) {}

let db: BetterSQLite3Database<typeof schema>;

function service(qboEnv: string | undefined): TestQbo {
    return new TestQbo({} as D1Database, 'cid', 'csec', 'whsec', JWT_SECRET, qboEnv);
}

async function connect(svc: TestQbo, tenantId: string) {
    await svc.saveConnection({
        tenantId,
        realmId:               `realm-${tenantId.slice(-1)}`,
        companyName:           'Acme Books',
        accessToken:           'access-plain',
        refreshToken:          'refresh-plain',
        refreshTokenExpiresIn: 8_726_400,
    });
    // Pin the two instants the status reports so the assertion is exact.
    await db.update(schema.qboConnections)
        .set({ createdAt: CONNECTED_AT, tokenExpiresAt: ACCESS_EXPIRES_AT })
        .where(eq(schema.qboConnections.tenantId, tenantId));
}

let seq = 0;
async function mapRow(tenantId: string, oiType: 'contact' | 'invoice' | 'refund') {
    seq += 1;
    await db.insert(schema.qboEntityMap).values({
        id:           `map-${seq}`,
        tenantId,
        oiType,
        oiId:         `oi-${seq}`,
        qboType:      oiType === 'contact' ? 'Customer' : oiType === 'invoice' ? 'Invoice' : 'CreditMemo',
        qboId:        `q-${seq}`,
        qboSyncToken: '0',
        syncedAt:     CONNECTED_AT,
    });
}

beforeEach(async () => {
    seq = 0;
    const fixture = createTestDb();
    db = fixture.db as unknown as BetterSQLite3Database<typeof schema>;
    await setupSchema(fixture.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
});

describe('getConnectionStatus: matched counts', () => {
    it('counts matched contacts and matched invoices separately', async () => {
        const svc = service('sandbox');
        await connect(svc, TENANT);
        await mapRow(TENANT, 'contact');
        await mapRow(TENANT, 'contact');
        await mapRow(TENANT, 'invoice');
        await mapRow(TENANT, 'invoice');
        await mapRow(TENANT, 'invoice');

        const status = await svc.getConnectionStatus(TENANT);

        expect(status?.mappedCustomers).toBe(2);
        expect(status?.mappedInvoices).toBe(3);
    });

    it('does not count another company\'s matches, and does count this one\'s (isolation)', async () => {
        const svc = service('sandbox');
        await connect(svc, TENANT);
        await connect(svc, OTHER);
        await mapRow(TENANT, 'contact');
        await mapRow(OTHER, 'contact');
        await mapRow(OTHER, 'contact');
        await mapRow(OTHER, 'invoice');

        const mine = await svc.getConnectionStatus(TENANT);
        const theirs = await svc.getConnectionStatus(OTHER);

        expect(mine?.mappedCustomers).toBe(1);
        expect(mine?.mappedInvoices).toBe(0);
        // Positive control: the same query does see the other company's rows
        // when asked for them, so the zeros above are isolation and not a
        // count that is always empty.
        expect(theirs?.mappedCustomers).toBe(2);
        expect(theirs?.mappedInvoices).toBe(1);
    });

    it('counts neither a refund twin as a customer nor as an invoice', async () => {
        const svc = service('sandbox');
        await connect(svc, TENANT);
        await mapRow(TENANT, 'refund');
        await mapRow(TENANT, 'refund');
        const withRefundsOnly = await svc.getConnectionStatus(TENANT);

        await mapRow(TENANT, 'contact');
        await mapRow(TENANT, 'invoice');
        const withBoth = await svc.getConnectionStatus(TENANT);

        expect(withRefundsOnly).toMatchObject({ mappedCustomers: 0, mappedInvoices: 0 });
        expect(withBoth).toMatchObject({ mappedCustomers: 1, mappedInvoices: 1 });
    });
});

describe('getConnectionStatus: instants', () => {
    it('reports connectedAt as the connection row\'s created_at in epoch seconds', async () => {
        const svc = service('sandbox');
        await connect(svc, TENANT);

        const status = await svc.getConnectionStatus(TENANT);

        expect(status?.connectedAt).toBe(CONNECTED_AT.getTime() / 1000);
    });
});

describe('getConnectionStatus: environment', () => {
    it.each(['sandbox', 'production'] as const)('reports %s when QBO_ENV names it', async (env) => {
        const svc = service(env);
        await connect(svc, TENANT);

        expect((await svc.getConnectionStatus(TENANT))?.environment).toBe(env);
    });

    it('reports null, never sandbox, when QBO_ENV is unset', async () => {
        const svc = service(undefined);
        await connect(svc, TENANT);

        expect((await svc.getConnectionStatus(TENANT))?.environment).toBeNull();
    });

    it.each(['Sandbox', 'prod', '', ' sandbox '])('reports null for the unusable value %j', async (value) => {
        const svc = service(value);
        await connect(svc, TENANT);

        expect((await svc.getConnectionStatus(TENANT))?.environment).toBeNull();
    });
});

describe('getConnectionStatus: existing fields are unchanged', () => {
    it('still reports the connection identity, sync switch and empty lists', async () => {
        const svc = service('sandbox');
        await connect(svc, TENANT);

        const status = await svc.getConnectionStatus(TENANT);

        expect(status).toMatchObject({
            realmId:              `realm-${TENANT.slice(-1)}`,
            companyName:          'Acme Books',
            lastSyncAt:           null,
            syncEnabled:          true,
            openErrors:           [],
            paymentDiscrepancies: [],
            heldDepositCount:     0,
        });
        expect(typeof status?.refreshTokenExpiresAt).toBe('number');
    });

    it('is null for a company with no connection', async () => {
        expect(await service('sandbox').getConnectionStatus(TENANT)).toBeNull();
    });
});
