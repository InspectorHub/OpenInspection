/**
 * Starter content seeds a SERVICE CATALOGUE.
 *
 * Production had 43 event types, 7 templates and zero services. Service lines
 * can only be attached from a catalogue, so an empty catalogue is why no
 * inspection had ever carried one — a product gap, not slow adoption.
 *
 * The alignment is the point: every seeded service names the template it
 * produces and the event-type slugs it implies, so three artefacts that used to
 * describe the same thing separately now line up by construction.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { seedStarterContent } from '../../../server/services/starter-content.service';
import { STARTER_SERVICES } from '../../../server/services/starter-content/fixtures/services';
import { EVENT_TYPES } from '../../../server/services/starter-content/fixtures/event-types';

describe('seedStarterContent — service catalogue', () => {
    let db: BetterSQLite3Database<typeof schema>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sqlite: any;
    const tenantId = 'tenant-services-1';

    const listServices = () =>
        db.select().from(schema.services).where(eq(schema.services.tenantId, tenantId)).all();
    const findService = (name: string) =>
        db.select().from(schema.services)
            .where(and(eq(schema.services.tenantId, tenantId), eq(schema.services.name, name))).get();

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(db);
        await db.insert(schema.tenants).values({
            id: tenantId, slug: 't', createdAt: new Date(),
        });
    });

    afterEach(() => { sqlite.close(); });

    it('seeds a catalogue where there was none', async () => {
        expect(await listServices()).toHaveLength(0);
        const result = await seedStarterContent({} as never, tenantId);
        expect(result.servicesSeeded).toBe(STARTER_SERVICES.length);
        expect(await listServices()).toHaveLength(STARTER_SERVICES.length);
    });

    it('links every seeded service to a template that exists', async () => {
        await seedStarterContent({} as never, tenantId);
        const templateIds = new Set(
            (await db.select().from(schema.templates).where(eq(schema.templates.tenantId, tenantId)).all())
                .map(t => t.id),
        );
        for (const s of await listServices()) {
            expect(s.templateId).not.toBeNull();
            expect(templateIds.has(s.templateId as string)).toBe(true);
        }
    });

    it('links radon to both of its visits, in order', async () => {
        await seedStarterContent({} as never, tenantId);
        const radon = await findService('Radon Testing');
        // Drop-off before pickup: a pickup proposed first is a nonsense visit
        // sequence, and the order is the only thing carrying that meaning.
        expect(radon?.defaultEventTypeSlugs).toEqual(['radon_dropoff', 'radon_pickup']);
    });

    it('every referenced event-type slug is actually seeded', async () => {
        // The failure this catches: a service pointing at a slug that only
        // existed in the other, manually-triggered seed list.
        await seedStarterContent({} as never, tenantId);
        const seededSlugs = new Set(
            (await db.select().from(schema.eventTypes).where(eq(schema.eventTypes.tenantId, tenantId)).all())
                .map(e => e.slug),
        );
        const referenced = STARTER_SERVICES.flatMap(s => s.defaultEventTypeSlugs);
        expect(referenced.length).toBeGreaterThan(0);
        for (const slug of referenced) expect(seededSlugs.has(slug)).toBe(true);
    });

    it('gives every service a price, because the column cannot hold none', async () => {
        // services.price is NOT NULL and inspection_services.price_snapshot
        // copies it, so "seed the entry without a price" was never available.
        // These are editable starting numbers, not placeholders.
        for (const s of await (async () => { await seedStarterContent({} as never, tenantId); return listServices(); })()) {
            expect(typeof s.price).toBe('number');
            expect(s.price).toBeGreaterThan(0);
        }
    });

    it('is idempotent and never resurrects a service the tenant renamed', async () => {
        await seedStarterContent({} as never, tenantId);
        await db.update(schema.services).set({ name: 'Our Sewer Scope' })
            .where(and(eq(schema.services.tenantId, tenantId), eq(schema.services.name, 'Sewer Scope')));

        const second = await seedStarterContent({} as never, tenantId);

        // Re-seeding must not hand them back a second "Sewer Scope" beside the
        // one they renamed.
        expect(second.servicesSeeded).toBe(1);
        expect(await findService('Our Sewer Scope')).toBeTruthy();
        expect(await listServices()).toHaveLength(STARTER_SERVICES.length + 1);
    });

    it('seeds one event type per fixture entry and no duplicate sewer scope', async () => {
        await seedStarterContent({} as never, tenantId);
        const slugs = (await db.select().from(schema.eventTypes)
            .where(eq(schema.eventTypes.tenantId, tenantId)).all()).map(e => e.slug).sort();

        expect(slugs).toEqual(EVENT_TYPES.map(e => e.slug).sort());
        // The two seed lists used to disagree here: one real-world thing under
        // `starter_sewer_scope` and `sewer_scope` both.
        expect(slugs).toContain('sewer_scope');
        expect(slugs).not.toContain('starter_sewer_scope');
    });
});
