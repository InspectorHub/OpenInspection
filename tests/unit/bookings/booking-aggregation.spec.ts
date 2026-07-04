import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb, setupSchema } from '../db';
import { BookingService } from '../../../server/services/booking.service';
import { tenants, users, services, availability, availabilityOverrides, inspections, inspectionInspectors, serviceInspectors } from '../../../server/lib/db/schema';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// 2026-06-08 is a Monday (dayOfWeek = 1).
// Must stay future-dated if a past-date guard ever lands in the booking handler.
const MONDAY = '2026-06-08';

describe('BookingService tenant aggregation (IA-26)', () => {
    let svc: BookingService;
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: any;

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db; sqlite = setup.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as any).mockReturnValue(db);
        svc = new BookingService({} as any);

        await db.insert(tenants).values({ id: 't1', name: 'Acme', slug: 'acme', createdAt: new Date() });
        const u = (id: string, role: string) => ({
            id, tenantId: 't1', email: `${id}@x.com`, passwordHash: 'h', role, name: id, createdAt: new Date(),
        });
        await db.insert(users).values([u('u1', 'owner'), u('u2', 'inspector'), u('u3', 'inspector')]);
        await db.insert(services).values([
            { id: 's1', tenantId: 't1', name: 'Residential', price: 40000, createdAt: new Date() },
            { id: 's2', tenantId: 't1', name: 'Radon', price: 15000, createdAt: new Date() },
        ]);
        await db.insert(serviceInspectors).values({ serviceId: 's2', userId: 'u2', tenantId: 't1', createdAt: new Date() });
        const win = (id: string, inspectorId: string) => ({
            id, tenantId: 't1', inspectorId, dayOfWeek: 1, startTime: '08:00', endTime: '10:00', createdAt: new Date(),
        });
        await db.insert(availability).values([win('a1', 'u1'), win('a2', 'u2')]);
        await db.insert(inspections).values({
            id: 'i1', tenantId: 't1', inspectorId: 'u2', propertyAddress: '1 Main St',
            date: `${MONDAY}T09:00:00Z`, status: 'scheduled', createdAt: new Date(),
        });
        await db.insert(inspectionInspectors).values({
            inspectionId: 'i1', userId: 'u2', tenantId: 't1', role: 'lead', createdAt: new Date(),
        });
    });
    afterEach(() => sqlite.close());

    it('getQualifiedInspectorIds: zero rows = all staff; rows restrict; multi-service intersects', async () => {
        expect((await svc.getQualifiedInspectorIds('t1', ['s1'])).sort()).toEqual(['u1', 'u2', 'u3']);
        expect(await svc.getQualifiedInspectorIds('t1', ['s2'])).toEqual(['u2']);
        expect(await svc.getQualifiedInspectorIds('t1', ['s1', 's2'])).toEqual(['u2']);
        expect((await svc.getQualifiedInspectorIds('t1', [])).sort()).toEqual(['u1', 'u2', 'u3']);
    });

    it('getTenantSlots unions windows and tracks free inspectors per slot', async () => {
        const slots = await svc.getTenantSlots('t1', MONDAY, []);
        const at = (time: string) => slots.find(s => s.time === time)!;
        expect(at('09:00').available).toBe(true);            // u2 busy (i1) but u1 free
        expect(at('09:00').inspectorIds).toEqual(['u1']);
        expect(at('08:00').inspectorIds.sort()).toEqual(['u1', 'u2']);
        expect(slots.every(s => !s.inspectorIds.includes('u3'))).toBe(true); // no windows -> never contributes
    });

    it('getTenantSlots respects qualification: radon-only day belongs to u2', async () => {
        const slots = await svc.getTenantSlots('t1', MONDAY, ['s2']);
        expect(slots.find(s => s.time === '08:00')!.inspectorIds).toEqual(['u2']);
        expect(slots.find(s => s.time === '09:00')!.available).toBe(false); // only qualified is busy
    });

    it('hasAnyHours reports whether ANY qualified staff configured a schedule', async () => {
        expect(await svc.hasAnyHours('t1', [])).toBe(true);
        expect(await svc.hasAnyHours('t1', ['s2'])).toBe(true);
    });

    it('solo degenerate case: single configured inspector behaves like the legacy path', async () => {
        const slots = await svc.getTenantSlots('t1', MONDAY, ['s2']);
        const legacy = await svc.getAvailableSlots('t1', 'u2', MONDAY);
        expect(slots.map(s => ({ time: s.time, available: s.available }))).toEqual(legacy);
    });

    it('pickInspector is deterministic by (name, id)', async () => {
        expect(await svc.pickInspector('t1', ['u3', 'u1', 'u2'])).toBe('u1');
        expect(await svc.pickInspector('t1', [])).toBeNull();
    });

    it('hasAnyHours negative: qualified inspector with no availability rows returns false', async () => {
        // s3 is restricted to u3 who has NO availability rows
        await db.insert(services).values({ id: 's3', tenantId: 't1', name: 'Mold', price: 20000, createdAt: new Date() });
        await db.insert(serviceInspectors).values({ serviceId: 's3', userId: 'u3', tenantId: 't1', createdAt: new Date() });

        expect(await svc.hasAnyHours('t1', ['s3'])).toBe(false);
    });

    it('blocking override: u2 blocked on MONDAY removes all s2 slots; u1 still serves all-staff', async () => {
        // Block u2 entirely on MONDAY
        await db.insert(availabilityOverrides).values({
            id: 'ov1', tenantId: 't1', inspectorId: 'u2', date: MONDAY,
            isAvailable: false, startTime: null, endTime: null, createdAt: new Date(),
        });

        // s2 is sole-qualified to u2 — with blocking override u2 yields no effective windows
        const s2Slots = await svc.getTenantSlots('t1', MONDAY, ['s2']);
        expect(s2Slots).toEqual([]);

        // All-staff: u1 still has 08:00-10:00 windows; 08:00 must be available via u1
        const allSlots = await svc.getTenantSlots('t1', MONDAY, []);
        const slot0800 = allSlots.find(s => s.time === '08:00')!;
        expect(slot0800.available).toBe(true);
        expect(slot0800.inspectorIds).toEqual(['u1']);
    });

    it('additive override: blocking + additive row gives u2 only the 12:00-13:00 window', async () => {
        // Insert blocking row (replaces recurring) AND additive row (adds 12:00-13:00)
        await db.insert(availabilityOverrides).values([
            {
                id: 'ov-block', tenantId: 't1', inspectorId: 'u2', date: MONDAY,
                isAvailable: false, startTime: null, endTime: null, createdAt: new Date(),
            },
            {
                id: 'ov-add', tenantId: 't1', inspectorId: 'u2', date: MONDAY,
                isAvailable: true, startTime: '12:00', endTime: '13:00', createdAt: new Date(),
            },
        ]);

        // s2 sole-qualified to u2: effective windows = just 12:00-13:00 (two 30-min slots)
        const slots = await svc.getTenantSlots('t1', MONDAY, ['s2']);
        const times = slots.map(s => s.time);

        // Must have 12:00 and 12:30
        expect(times).toContain('12:00');
        expect(times).toContain('12:30');

        // Must NOT have any 08:xx or 09:xx slots (recurring window is replaced)
        expect(times.some(t => t.startsWith('08:') || t.startsWith('09:'))).toBe(false);

        // Both slots should be available (u2 has no inspection at 12:00 or 12:30)
        expect(slots.find(s => s.time === '12:00')!.available).toBe(true);
        expect(slots.find(s => s.time === '12:30')!.available).toBe(true);
    });
});
