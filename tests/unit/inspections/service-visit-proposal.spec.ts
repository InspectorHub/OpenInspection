/**
 * A service knows which visits it implies.
 *
 * Radon is the case that motivates the whole feature: it is two visits, a
 * drop-off and a pickup at least 48h later, and the pickup is the one that
 * otherwise lives only in the inspector's head.
 *
 * The reference is by SLUG rather than event-type id, and these tests pin the
 * consequence of that choice — a slug with no matching row degrades to a
 * shorter proposal instead of a dangling id or a 500 on the order screen.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { ServiceService } from '../../../server/services/service.service';

const TENANT = 'tenant-visits-1';

describe('ServiceService.proposeEventsForService', () => {
    let db: BetterSQLite3Database<typeof schema>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sqlite: any;
    let svc: ServiceService;

    async function addEventType(slug: string, name: string) {
        await db.insert(schema.eventTypes).values({
            id: `et-${slug}`, tenantId: TENANT, name, slug,
            defaultDurationMin: 15, defaultPriceCents: 0, color: '#000',
            sortOrder: 1, active: true, createdAt: new Date(),
        } as never);
    }

    async function addService(id: string, name: string, slugs: string[] | null) {
        await db.insert(schema.services).values({
            id, tenantId: TENANT, name, description: null, price: 15000,
            durationMinutes: 15, templateId: null, agreementId: null,
            active: true, sortOrder: 1, createdAt: new Date(),
            defaultEventTypeSlugs: slugs,
        } as never);
    }

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(db);
        await db.insert(schema.tenants).values({
            id: TENANT, slug: 't', createdAt: new Date(),
        });
        await addEventType('radon_dropoff', 'Radon Drop-off');
        await addEventType('radon_pickup', 'Radon Pickup');
        await addService('svc-radon', 'Radon Testing', ['radon_dropoff', 'radon_pickup']);
        await addService('svc-sewer', 'Sewer Scope', []);
        svc = new ServiceService({} as never);
    });

    afterEach(() => { sqlite.close(); });

    it('proposes the two radon visits, drop-off first', async () => {
        const proposed = await svc.proposeEventsForService(TENANT, 'svc-radon');
        expect(proposed.map(e => e.slug)).toEqual(['radon_dropoff', 'radon_pickup']);
    });

    it('proposes nothing for a service with no default visits', async () => {
        expect(await svc.proposeEventsForService(TENANT, 'svc-sewer')).toEqual([]);
    });

    it('degrades to what remains when a referenced event type was deleted', async () => {
        // Soft references are chosen deliberately. Assert the degradation rather
        // than discovering it as a 500 the first time a tenant tidies up.
        await db.delete(schema.eventTypes)
            .where(and(eq(schema.eventTypes.tenantId, TENANT), eq(schema.eventTypes.slug, 'radon_pickup')));

        const proposed = await svc.proposeEventsForService(TENANT, 'svc-radon');
        expect(proposed.map(e => e.slug)).toEqual(['radon_dropoff']);
    });

    it('never proposes another tenant\'s event type of the same slug', async () => {
        await db.insert(schema.tenants).values({
            id: 'other', slug: 'o', createdAt: new Date(),
        });
        await db.insert(schema.eventTypes).values({
            id: 'et-other', tenantId: 'other', name: 'Radon Pickup', slug: 'radon_pickup',
            defaultDurationMin: 15, defaultPriceCents: 0, color: '#000',
            sortOrder: 1, active: true, createdAt: new Date(),
        } as never);
        await db.delete(schema.eventTypes)
            .where(and(eq(schema.eventTypes.tenantId, TENANT), eq(schema.eventTypes.slug, 'radon_pickup')));

        const proposed = await svc.proposeEventsForService(TENANT, 'svc-radon');
        expect(proposed.map(e => e.id)).toEqual(['et-radon_dropoff']);
    });

    it('proposes nothing for a service that is not this tenant\'s', async () => {
        expect(await svc.proposeEventsForService('other', 'svc-radon')).toEqual([]);
    });
});
