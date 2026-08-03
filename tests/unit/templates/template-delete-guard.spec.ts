/**
 * `services.template_id` is the SECOND foreign key to `templates`, and
 * `deleteTemplate` only ever checked the first one (`inspections.template_id`).
 *
 * Latent while the services catalogue was empty. Seeding it ends that: from now
 * on a fresh tenant has seven services each defaulting to a template, so the
 * unguarded path would fail at the foreign key with a message naming neither
 * the table nor the row.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { TemplateService } from '../../../server/services/template.service';

const TENANT = 'tenant-tpl-guard';
const TEMPLATE_ID = 'tpl-1';

describe('deleteTemplate — the service catalogue reference', () => {
    let db: BetterSQLite3Database<typeof schema>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sqlite: any;
    let svc: TemplateService;

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(db);
        await db.insert(schema.tenants).values({
            id: TENANT, name: 'T', slug: 't', createdAt: new Date(),
        });
        await db.insert(schema.templates).values({
            id: TEMPLATE_ID, tenantId: TENANT, name: 'Sewer Scope Inspection',
            version: 1, schema: JSON.stringify({ sections: [] }), createdAt: new Date(),
        } as never);
        svc = new TemplateService({} as never);
    });

    afterEach(() => { sqlite.close(); });

    async function addService(name: string, templateId: string | null) {
        await db.insert(schema.services).values({
            id: `svc-${name}`, tenantId: TENANT, name, description: null,
            price: 25000, durationMinutes: 60, templateId, agreementId: null,
            active: true, sortOrder: 1, createdAt: new Date(),
            defaultEventTypeSlugs: [],
        } as never);
    }

    it('refuses to delete a template a service defaults to', async () => {
        await addService('Sewer Scope', TEMPLATE_ID);
        await expect(svc.deleteTemplate(TEMPLATE_ID, TENANT)).rejects.toThrow(/Cannot delete/);
    });

    it('names the service that is blocking the delete', async () => {
        // "Conflict" with no subject sends the tenant hunting through their
        // inspections for a reference that is in their service catalogue.
        await addService('Sewer Scope', TEMPLATE_ID);
        await expect(svc.deleteTemplate(TEMPLATE_ID, TENANT)).rejects.toThrow(/Sewer Scope/);
    });

    it('still deletes a template nothing references', async () => {
        await addService('Radon Testing', null);
        await expect(svc.deleteTemplate(TEMPLATE_ID, TENANT)).resolves.not.toThrow();
        const rows = await db.select().from(schema.templates).all();
        expect(rows).toHaveLength(0);
    });

    it('is still blocked by a service the tenant soft-deleted', async () => {
        // `deleteService` sets active:false and leaves template_id in place, so
        // the foreign key survives the delete the tenant thinks they did. The
        // guard deliberately does not filter on `active`: if it did, this case
        // would skip the friendly message and fail at the FK instead.
        await addService('Sewer Scope', TEMPLATE_ID);
        await db.update(schema.services).set({ active: false });

        await expect(svc.deleteTemplate(TEMPLATE_ID, TENANT)).rejects.toThrow(/Sewer Scope/);
    });
});
