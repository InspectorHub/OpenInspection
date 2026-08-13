import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IcsService } from '../../../server/services/ics.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-000000000001';
const USER = '00000000-0000-0000-0000-000000000010';
const HELPER = '00000000-0000-0000-0000-000000000011';

describe('IcsService — inspector feeds', () => {
    let svc: IcsService;
    let testDb: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        sqlite = fixture.sqlite;
        await setupSchema(sqlite);

        await testDb.insert(schema.tenants).values([{
            id: TENANT, slug: 'a', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        }]);
        await testDb.insert(schema.tenantConfigs).values({
            tenantId: TENANT, defaultTimezone: 'America/New_York', updatedAt: new Date(),
        });
        await testDb.insert(schema.users).values([
            {
                id: USER, tenantId: TENANT, email: 'm@t.com', name: 'Mike',
                role: 'inspector', slug: 'mike', passwordHash: 'x', createdAt: new Date(),
            },
            {
                id: HELPER, tenantId: TENANT, email: 'h@t.com', name: 'Helper',
                role: 'inspector', slug: 'helper', passwordHash: 'x', createdAt: new Date(),
            },
        ]);
        await testDb.insert(schema.inspections).values([
            {
                id: 'i1', tenantId: TENANT, propertyAddress: '1 Main St',
                date: '2026-06-01', status: 'confirmed', paymentStatus: 'unpaid',
                price: 0, agreementRequired: false, paymentRequired: false, createdAt: new Date(),
            },
            {
                id: 'i2', tenantId: TENANT, propertyAddress: '2 Oak Ave',
                date: '2026-06-02', status: 'cancelled', paymentStatus: 'unpaid',
                price: 0, agreementRequired: false, paymentRequired: false, createdAt: new Date(),
            },
        ]);
        // Assignment lives in the LINK TABLE. Note inspections.inspector_id is
        // left NULL on purpose: it is the frozen legacy column, and a feed that
        // reads it sees nothing here.
        await testDb.insert(schema.inspectionInspectors).values([
            { tenantId: TENANT, inspectionId: 'i1', userId: USER, role: 'lead', createdAt: new Date() },
            { tenantId: TENANT, inspectionId: 'i2', userId: USER, role: 'lead', createdAt: new Date() },
        ]);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        svc = new IcsService({} as unknown as D1Database);
    });

    afterEach(() => {
        sqlite.close();
        vi.clearAllMocks();
    });

    describe('busyFeedForInspector', () => {
        it('emits confirmed inspections only and no PII', async () => {
            const ics = await svc.busyFeedForInspector(TENANT, 'mike');
            expect(ics).toContain('BEGIN:VCALENDAR');
            expect(ics).toContain('END:VCALENDAR');
            expect(ics).toContain('SUMMARY:Busy');
            expect(ics).toContain('UID:i1@');
            expect(ics).not.toContain('UID:i2@');
            expect(ics).not.toContain('1 Main St');
            expect(ics).not.toContain('Sarah');
            expect(ics).not.toContain('s@t.com');
            expect(ics).not.toMatch(/LOCATION:/);
            expect(ics).not.toMatch(/DESCRIPTION:/);
        });

        /**
         * This feed used to filter on `inspections.inspector_id` — the frozen
         * legacy column — while every write goes to `inspection_inspectors`.
         * The fixture leaves the column NULL, so a version that reads it
         * produces an empty calendar for an inspector with real work.
         */
        it('reads assignment from the link table, not the dead inspector_id column', async () => {
            const ics = await svc.busyFeedForInspector(TENANT, 'mike');
            expect(ics).toContain('BEGIN:VEVENT');
            expect(ics).toContain('UID:i1@');
        });

        it('shows lead assignments only, not helper work', async () => {
            await testDb.insert(schema.inspectionInspectors).values({
                tenantId: TENANT, inspectionId: 'i1', userId: HELPER,
                role: 'helper', createdAt: new Date(),
            });
            const ics = await svc.busyFeedForInspector(TENANT, 'helper');
            expect(ics).not.toContain('BEGIN:VEVENT');
        });

        /**
         * THE INSTANT, not merely the format. 08:00 in America/New_York on
         * 2026-06-01 (EDT, UTC-4) is 12:00Z. The previous implementation
         * composed `${day}T08:00:00Z` and published 08:00Z — 04:00 local, four
         * hours before the appointment. Subscribers were told the inspector was
         * busy at the wrong time of day.
         */
        it('publishes the tenant-local start as the correct UTC instant', async () => {
            const ics = await svc.busyFeedForInspector(TENANT, 'mike');
            expect(ics).toContain('DTSTART:20260601T120000Z');
            expect(ics).not.toContain('DTSTART:20260601T080000Z');
        });

        it('prefers the stamped instant over the civil-date fallback', async () => {
            await testDb.update(schema.inspections)
                .set({
                    scheduledStartMs: new Date(Date.UTC(2026, 5, 1, 17, 30)),
                    scheduledEndMs: new Date(Date.UTC(2026, 5, 1, 19, 0)),
                });
            const ics = await svc.busyFeedForInspector(TENANT, 'mike');
            expect(ics).toContain('DTSTART:20260601T173000Z');
            expect(ics).toContain('DTEND:20260601T190000Z');
        });

        it('returns an empty calendar for an unknown slug', async () => {
            const ics = await svc.busyFeedForInspector(TENANT, 'nonexistent');
            expect(ics).toContain('BEGIN:VCALENDAR');
            expect(ics).not.toContain('BEGIN:VEVENT');
        });

        it('enforces tenant scope', async () => {
            const OTHER = '00000000-0000-0000-0000-000000000099';
            await testDb.insert(schema.tenants).values({
                id: OTHER, slug: 'o', status: 'active',
                deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
            });
            const ics = await svc.busyFeedForInspector(OTHER, 'mike');
            expect(ics).toContain('BEGIN:VCALENDAR');
            expect(ics).not.toContain('BEGIN:VEVENT');
        });

        it('emits TRANSP:OPAQUE so subscribers see the slot as busy', async () => {
            expect(await svc.busyFeedForInspector(TENANT, 'mike')).toContain('TRANSP:OPAQUE');
        });

        it('formats DTSTART/DTEND as UTC stamps (RFC 5545)', async () => {
            const ics = await svc.busyFeedForInspector(TENANT, 'mike');
            expect(ics).toMatch(/DTSTART:\d{8}T\d{6}Z/);
            expect(ics).toMatch(/DTEND:\d{8}T\d{6}Z/);
        });
    });

    describe('scheduleFeedForInspector', () => {
        it('carries the property address the busy feed withholds', async () => {
            const ics = await svc.scheduleFeedForInspector(TENANT, USER);
            expect(ics).toContain('SUMMARY:1 Main St');
            expect(ics).toContain('LOCATION:1 Main St');
        });

        it('still excludes cancelled work and helper assignments', async () => {
            const ics = await svc.scheduleFeedForInspector(TENANT, USER);
            expect(ics).toContain('UID:i1@');
            expect(ics).not.toContain('UID:i2@');
            expect(await svc.scheduleFeedForInspector(TENANT, HELPER)).not.toContain('BEGIN:VEVENT');
        });

        it('uses the same corrected instant as the busy feed', async () => {
            expect(await svc.scheduleFeedForInspector(TENANT, USER))
                .toContain('DTSTART:20260601T120000Z');
        });

        it('escapes ICS control characters in an address', async () => {
            await testDb.update(schema.inspections)
                .set({ propertyAddress: '1 Main St, Apt; 2' });
            const ics = await svc.scheduleFeedForInspector(TENANT, USER);
            expect(ics).toContain('LOCATION:1 Main St\\, Apt\\; 2');
        });
    });
});
