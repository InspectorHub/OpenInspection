import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IcsService } from '../../../server/services/ics.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-000000000001';
const USER = '00000000-0000-0000-0000-000000000010';

describe('IcsService.busyFeedForInspector — Sprint C-2', () => {
    let svc: IcsService;
    let testDb: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        sqlite = fixture.sqlite;
        await setupSchema(sqlite);

        await testDb.insert(schema.tenants).values([{
            id: TENANT, name: 'A', slug: 'a', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        }]);
        await testDb.insert(schema.users).values([{
            id: USER, tenantId: TENANT, email: 'm@t.com', name: 'Mike',
            role: 'inspector', slug: 'mike', passwordHash: 'x',
            createdAt: new Date(),
        }]);
        await testDb.insert(schema.inspections).values([
            {
                id: 'i1', tenantId: TENANT, inspectorId: USER,
                propertyAddress: '1 Main St', clientName: 'Sarah', clientEmail: 's@t.com',
                date: '2026-06-01', status: 'confirmed', paymentStatus: 'unpaid',
                price: 0, agreementRequired: false, paymentRequired: false,
                createdAt: new Date(),
            },
            {
                id: 'i2', tenantId: TENANT, inspectorId: USER,
                propertyAddress: '2 Oak Ave', clientName: 'Bob', clientEmail: 'b@t.com',
                date: '2026-06-02', status: 'cancelled', paymentStatus: 'unpaid',
                price: 0, agreementRequired: false, paymentRequired: false,
                createdAt: new Date(),
            },
        ]);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        svc = new IcsService({} as unknown as D1Database);
    });

    afterEach(() => {
        sqlite.close();
        vi.clearAllMocks();
    });

    it('emits BEGIN:VCALENDAR with confirmed inspections only and no PII', async () => {
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

    it('returns empty calendar for unknown slug', async () => {
        const ics = await svc.busyFeedForInspector(TENANT, 'nonexistent');
        expect(ics).toContain('BEGIN:VCALENDAR');
        expect(ics).toContain('END:VCALENDAR');
        expect(ics).not.toContain('BEGIN:VEVENT');
    });

    it('enforces tenant scope', async () => {
        const OTHER = '00000000-0000-0000-0000-000000000099';
        await testDb.insert(schema.tenants).values({
            id: OTHER, name: 'O', slug: 'o', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        const ics = await svc.busyFeedForInspector(OTHER, 'mike');
        expect(ics).toContain('BEGIN:VCALENDAR');
        expect(ics).not.toContain('BEGIN:VEVENT');
    });

    it('emits TRANSP:OPAQUE so subscribers see the slot as busy', async () => {
        const ics = await svc.busyFeedForInspector(TENANT, 'mike');
        expect(ics).toContain('TRANSP:OPAQUE');
    });

    it('formats DTSTART/DTEND as UTC stamps (RFC 5545)', async () => {
        const ics = await svc.busyFeedForInspector(TENANT, 'mike');
        expect(ics).toMatch(/DTSTART:\d{8}T\d{6}Z/);
        expect(ics).toMatch(/DTEND:\d{8}T\d{6}Z/);
    });
});
