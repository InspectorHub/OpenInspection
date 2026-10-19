/**
 * DELETE /api/calendar/disconnect through the REAL app (in-memory SQLite, real
 * middleware and JWT). Disconnecting a calendar used to delete only the
 * connection row: the busy blocks it had synced stayed (and kept hiding the
 * inspector's days from customers), as did the read-calendar choices and the
 * links to events on the calendar being left.
 *
 * Pinned here: disconnecting a provider removes, in one batch, that user's
 * connection AND their overrides synced from that provider AND the external
 * links AND the read calendars of that connection - and nothing else: not
 * another provider's rows, not hand-entered overrides, not another user's rows,
 * not another company's rows. The provider is validated, and omitting it means
 * every provider the user is connected to.
 */
import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { app } from '../../../server/index';
import { makeExecutionContext } from '../helpers/exec-ctx';
import * as schema from '../../../server/lib/db/schema';
import { buildKeyring, signJwt } from '../../../server/lib/jwt-keyring';
import { createHarness, TENANT_ID, OWNER_ID, INSPECTOR_ID } from '../helpers/tenant-email-harness';

const OTHER_TENANT = '11111111-0000-4000-8000-0000000000ff';
const FOREIGN_USER = '22222222-0000-4000-8000-0000000000ff';

async function setup() {
    const h = await createHarness('standalone');
    const now = new Date();
    await h.db.insert(schema.tenants).values({ id: OTHER_TENANT, slug: 'other', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: now } as never);
    await h.db.insert(schema.users).values({ id: FOREIGN_USER, tenantId: OTHER_TENANT, email: 'o@other.test', passwordHash: 'h', role: 'inspector', name: 'Oto', createdAt: now });

    const conn = (id: string, tenantId: string, userId: string, provider: 'google' | 'apple') => ({
        id, tenantId, userId, provider, authType: provider === 'google' ? 'oauth' : 'caldav', credentialsEnc: 'x', credentialsDekEnc: 'y',
        capabilities: 'availability_read', calendarId: 'primary', connectedAt: now, updatedAt: now,
    });
    await h.db.insert(schema.calendarConnections).values([
        conn('c-g', TENANT_ID, INSPECTOR_ID, 'google'),
        conn('c-a', TENANT_ID, INSPECTOR_ID, 'apple'),
        conn('c-owner', TENANT_ID, OWNER_ID, 'google'),
        conn('c-foreign', OTHER_TENANT, FOREIGN_USER, 'google'),
    ] as never);
    const rc = (id: string, tenantId: string, connectionId: string) => ({ id, tenantId, connectionId, externalCalendarId: `cal-${id}`, createdAt: now, updatedAt: now });
    await h.db.insert(schema.calendarConnectionReadCalendars).values([
        rc('rc-g1', TENANT_ID, 'c-g'), rc('rc-g2', TENANT_ID, 'c-g'), rc('rc-a', TENANT_ID, 'c-a'), rc('rc-owner', TENANT_ID, 'c-owner'), rc('rc-foreign', OTHER_TENANT, 'c-foreign'),
    ] as never);
    const link = (id: string, tenantId: string, userId: string, provider: 'google' | 'apple') => ({
        id, tenantId, userId, provider, entityType: 'calendar_block', entityId: `ent-${id}`, externalId: `ext-${id}`, createdAt: now, updatedAt: now,
    });
    await h.db.insert(schema.calendarExternalLinks).values([
        link('l-g', TENANT_ID, INSPECTOR_ID, 'google'), link('l-a', TENANT_ID, INSPECTOR_ID, 'apple'), link('l-owner', TENANT_ID, OWNER_ID, 'google'), link('l-foreign', OTHER_TENANT, FOREIGN_USER, 'google'),
    ] as never);
    const ov = (id: string, tenantId: string, inspectorId: string, source: 'google' | 'apple' | null, date: string) => ({
        id, tenantId, inspectorId, date, isAvailable: false, startTime: '10:00', endTime: '11:00', createdAt: now,
        ...(source ? { source, externalId: `ev-${id}` } : {}),
    });
    await h.db.insert(schema.availabilityOverrides).values([
        ov('o-g1', TENANT_ID, INSPECTOR_ID, 'google', '2027-01-05'), ov('o-g2', TENANT_ID, INSPECTOR_ID, 'google', '2027-01-06'),
        ov('o-a', TENANT_ID, INSPECTOR_ID, 'apple', '2027-01-07'), ov('o-manual', TENANT_ID, INSPECTOR_ID, null, '2027-01-08'),
        ov('o-owner', TENANT_ID, OWNER_ID, 'google', '2027-01-05'), ov('o-foreign', OTHER_TENANT, FOREIGN_USER, 'google', '2027-01-05'),
    ] as never);

    const keyring = await buildKeyring(h.env as unknown as Record<string, string | undefined>);
    const iat = Math.floor(Date.now() / 1000);
    const token = await signJwt({ sub: INSPECTOR_ID, 'custom:tenantId': TENANT_ID, 'custom:userRole': 'inspector', iat, exp: iat + 3600 }, keyring);
    const disconnect = async (query = '') => {
        const exec = makeExecutionContext({ label: 'disconnect' });
        const res = await app.request(`/api/calendar/disconnect${query}`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } }, h.env, exec.ctx);
        await exec.settle();
        return res;
    };
    const ids = async (table: 'calendarConnections' | 'calendarConnectionReadCalendars' | 'calendarExternalLinks' | 'availabilityOverrides') =>
        (await h.db.select({ id: schema[table].id }).from(schema[table]).all()).map((r) => r.id).sort();
    return { h, disconnect, ids, eq };
}

describe('disconnecting a calendar cleans up what it synced', () => {
    it('provider=google removes that user\'s Google connection, read calendars, links and synced overrides, and only those', async () => {
        const { h, disconnect, ids } = await setup();
        try {
            expect((await disconnect('?provider=google')).status).toBe(200);
            expect(await ids('calendarConnections')).toEqual(['c-a', 'c-foreign', 'c-owner']);
            expect(await ids('calendarConnectionReadCalendars')).toEqual(['rc-a', 'rc-foreign', 'rc-owner']);
            expect(await ids('calendarExternalLinks')).toEqual(['l-a', 'l-foreign', 'l-owner']);
            expect(await ids('availabilityOverrides')).toEqual(['o-a', 'o-foreign', 'o-manual', 'o-owner']);
        } finally { h.close(); }
    });

    it('provider=apple leaves the Google rows of the same user alone (other-provider control)', async () => {
        const { h, disconnect, ids } = await setup();
        try {
            expect((await disconnect('?provider=apple')).status).toBe(200);
            expect(await ids('calendarConnections')).toEqual(['c-foreign', 'c-g', 'c-owner']);
            expect(await ids('calendarExternalLinks')).toEqual(['l-foreign', 'l-g', 'l-owner']);
            expect(await ids('availabilityOverrides')).toEqual(['o-foreign', 'o-g1', 'o-g2', 'o-manual', 'o-owner']);
        } finally { h.close(); }
    });

    it('with no provider every provider of the user goes (the behaviour before the parameter existed), hand-entered rows stay', async () => {
        const { h, disconnect, ids } = await setup();
        try {
            expect((await disconnect()).status).toBe(200);
            expect(await ids('calendarConnections')).toEqual(['c-foreign', 'c-owner']);
            expect(await ids('calendarConnectionReadCalendars')).toEqual(['rc-foreign', 'rc-owner']);
            expect(await ids('calendarExternalLinks')).toEqual(['l-foreign', 'l-owner']);
            expect(await ids('availabilityOverrides')).toEqual(['o-foreign', 'o-manual', 'o-owner']);
        } finally { h.close(); }
    });

    it('an unknown provider is refused and nothing is deleted', async () => {
        const { h, disconnect, ids } = await setup();
        try {
            expect((await disconnect('?provider=outlook')).status).toBe(400);
            expect((await ids('calendarConnections')).length).toBe(4);
            expect((await ids('availabilityOverrides')).length).toBe(6);
        } finally { h.close(); }
    });
});
