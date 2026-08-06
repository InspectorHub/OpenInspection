import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', async (orig) => ({
    ...(await orig<Record<string, unknown>>()),
    drizzle: vi.fn(),
}));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const pushEvent = vi.fn(async () => 'gcal-new');
const patchEvent = vi.fn(async () => undefined);
const deleteEvent = vi.fn(async () => undefined);
vi.mock('../../../server/lib/calendar/registry', () => ({
    getCalendarProvider: () => ({ pushEvent, patchEvent, deleteEvent }),
}));

const openConnection = vi.fn();
vi.mock('../../../server/lib/calendar/connection', () => ({
    loadOpenGoogleConnection: (...a: unknown[]) => openConnection(...a),
}));
vi.mock('../../../server/lib/calendar/resolve-google-oauth', () => ({
    loadGoogleOAuthMode: async () => 'platform',
    resolveGoogleOAuthCredentials: async () => ({ clientId: 'cid', clientSecret: 'csec' }),
}));

import {
    pushInspectionToGoogle,
    deleteExternalForEntity,
} from '../../../server/lib/calendar/google-export';
import { ExternalEventGoneError } from '../../../server/lib/calendar/provider';

const TENANT = '00000000-0000-0000-0000-000000000001';
const LEAD = '00000000-0000-0000-0000-000000000010';
const OTHER = '00000000-0000-0000-0000-000000000011';
const INSP = 'insp-1';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const env = { DB: {} as D1Database, TENANT_CACHE: {} as any, JWT_SECRET: 's' };

function connection(capability: 'events_read_write' | 'availability_read') {
    return {
        connection: { id: 'c1', calendarId: 'primary', capabilities: capability },
        credentials: { refreshToken: 'rt' },
    };
}

describe('pushInspectionToGoogle — link-tracked two-way push', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        sqlite = fixture.sqlite;
        await setupSchema(sqlite);

        await db.insert(schema.tenants).values({
            id: TENANT, name: 'A', slug: 'a', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await db.insert(schema.tenantConfigs).values({
            tenantId: TENANT, defaultTimezone: 'America/New_York', updatedAt: new Date(),
        });
        await db.insert(schema.users).values([
            { id: LEAD, tenantId: TENANT, email: 'l@t.com', role: 'inspector', passwordHash: 'x', createdAt: new Date() },
            { id: OTHER, tenantId: TENANT, email: 'o@t.com', role: 'inspector', passwordHash: 'x', createdAt: new Date() },
        ]);
        await db.insert(schema.inspections).values({
            id: INSP, tenantId: TENANT, propertyAddress: '1 Main St',
            clientName: 'S', clientEmail: 's@t.com', date: '2026-06-01',
            scheduledStartMs: new Date(Date.UTC(2026, 5, 1, 14, 0)),
            durationMin: 120,
            status: 'confirmed', paymentStatus: 'unpaid', price: 0,
            agreementRequired: false, paymentRequired: false, createdAt: new Date(),
        });
        await db.insert(schema.inspectionInspectors).values({
            id: 'ii-1', tenantId: TENANT, inspectionId: INSP, userId: LEAD, role: 'lead',
            createdAt: new Date(),
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(db);
        openConnection.mockResolvedValue(connection('events_read_write'));
        pushEvent.mockClear(); patchEvent.mockClear(); deleteEvent.mockClear();
        pushEvent.mockResolvedValue('gcal-new');
    });

    afterEach(() => { sqlite.close(); vi.clearAllMocks(); });

    const links = () => db.select().from(schema.calendarExternalLinks).all();

    it('creates the event and records the link', async () => {
        const out = await pushInspectionToGoogle(env, TENANT, INSP);
        expect(out).toMatchObject({ pushed: true, externalId: 'gcal-new' });
        expect(pushEvent).toHaveBeenCalledTimes(1);

        const rows = await links();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            entityType: 'inspection', entityId: INSP, userId: LEAD, externalId: 'gcal-new',
        });
    });

    /**
     * The whole point of the link table: a reschedule must MOVE the entry the
     * inspector already has, not create a second one.
     */
    it('a second push patches the same external id and adds no second row', async () => {
        await pushInspectionToGoogle(env, TENANT, INSP);
        pushEvent.mockClear();

        const out = await pushInspectionToGoogle(env, TENANT, INSP);
        expect(out).toMatchObject({ pushed: true, externalId: 'gcal-new' });
        expect(patchEvent).toHaveBeenCalledTimes(1);
        expect(pushEvent).not.toHaveBeenCalled();
        expect(await links()).toHaveLength(1);
    });

    it('sends the tenant zone alongside the instant', async () => {
        await pushInspectionToGoogle(env, TENANT, INSP);
        expect(pushEvent.mock.calls[0]![0]).toMatchObject({
            event: expect.objectContaining({ timeZone: 'America/New_York' }),
        });
    });

    it('recreates when the owner deleted the remote event by hand', async () => {
        await pushInspectionToGoogle(env, TENANT, INSP);
        patchEvent.mockRejectedValueOnce(new ExternalEventGoneError('gcal-new'));
        pushEvent.mockResolvedValueOnce('gcal-fresh');

        const out = await pushInspectionToGoogle(env, TENANT, INSP);
        expect(out).toMatchObject({ pushed: true, externalId: 'gcal-fresh' });
        const rows = await links();
        expect(rows).toHaveLength(1);
        expect(rows[0]!.externalId).toBe('gcal-fresh');
    });

    it('refuses to write through a read-only connection', async () => {
        openConnection.mockResolvedValue(connection('availability_read'));
        const out = await pushInspectionToGoogle(env, TENANT, INSP);
        expect(out).toEqual({ pushed: false, reason: 'NO_WRITE_CAPABILITY' });
        expect(pushEvent).not.toHaveBeenCalled();
    });

    it('does not push an inspection nobody leads, and clears any old link', async () => {
        await pushInspectionToGoogle(env, TENANT, INSP);
        await db.delete(schema.inspectionInspectors);

        const out = await pushInspectionToGoogle(env, TENANT, INSP);
        expect(out).toEqual({ pushed: false, reason: 'NO_ASSIGNEE' });
        expect(deleteEvent).toHaveBeenCalledTimes(1);
        expect(await links()).toHaveLength(0);
    });

    it('removes the event from the calendar when the inspection is cancelled', async () => {
        await pushInspectionToGoogle(env, TENANT, INSP);
        await db.update(schema.inspections).set({ status: 'cancelled' });

        const out = await pushInspectionToGoogle(env, TENANT, INSP);
        expect(out).toEqual({ pushed: false, reason: 'CANCELLED' });
        expect(deleteEvent).toHaveBeenCalledWith(expect.objectContaining({ externalId: 'gcal-new' }));
        expect(await links()).toHaveLength(0);
    });

    /**
     * A reassignment must take the job off the previous inspector's calendar.
     * The delete has to be issued against THAT person's connection — deleting
     * with the incoming lead's handle would aim at the wrong calendar.
     */
    it('moves the event when the lead changes', async () => {
        await pushInspectionToGoogle(env, TENANT, INSP);
        await db.update(schema.inspectionInspectors).set({ userId: OTHER });
        pushEvent.mockResolvedValueOnce('gcal-other');

        const out = await pushInspectionToGoogle(env, TENANT, INSP);
        expect(out).toMatchObject({ pushed: true, externalId: 'gcal-other' });
        expect(deleteEvent).toHaveBeenCalledTimes(1);

        const rows = await links();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ userId: OTHER, externalId: 'gcal-other' });
    });

    /**
     * Production holds no rows with a non-NULL scheduled_start_ms, so the
     * fallback rung is the one that actually runs. A bare civil date names no
     * time and must be skipped with a reason rather than given an invented one.
     */
    describe('when scheduled_start_ms is absent', () => {
        beforeEach(async () => {
            await db.update(schema.inspections).set({ scheduledStartMs: null, scheduledEndMs: null });
        });

        it('derives the instant from a time suffix on date, in the tenant zone', async () => {
            await db.update(schema.inspections).set({ date: '2026-06-01T09:30' });
            const out = await pushInspectionToGoogle(env, TENANT, INSP);
            expect(out.pushed).toBe(true);
            // 09:30 in America/New_York on 2026-06-01 (EDT, UTC-4) = 13:30Z.
            const sent = pushEvent.mock.calls[0]![0] as unknown as { event: { start: Date } };
            expect(sent.event.start.toISOString()).toBe('2026-06-01T13:30:00.000Z');
        });

        it('skips a bare civil date with a named reason rather than inventing a time', async () => {
            const out = await pushInspectionToGoogle(env, TENANT, INSP);
            expect(out).toEqual({ pushed: false, reason: 'NO_START_TIME' });
            expect(pushEvent).not.toHaveBeenCalled();
        });
    });

    it('deleteExternalForEntity drops the link even when the provider refuses', async () => {
        await pushInspectionToGoogle(env, TENANT, INSP);
        deleteEvent.mockRejectedValueOnce(new Error('network'));

        await deleteExternalForEntity(env, TENANT, 'inspection', INSP);
        expect(await links()).toHaveLength(0);
    });
});
