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
            id: TENANT, slug: 't', createdAt: new Date(),
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

    // ── The three remaining references to templates.id (#307) ──────────────
    //
    // Recorded GREEN against the unfixed service first, then inverted. The
    // recording is the evidence: a guard test written after the guard passes
    // whether or not the guard is the thing making it pass.

    async function addReport(status: 'in_progress' | 'published', templateId: string | null) {
        await db.insert(schema.reports).values({
            id: `rep-${status}`, tenantId: TENANT, inspectionId: 'insp-1',
            kind: 'primary', title: 'Standard Home Inspection Report',
            status, templateId, createdAt: new Date(),
        } as never);
    }

    async function addLibraryImport(localEntityId: string | null) {
        await db.insert(schema.marketplaceLibraries).values({
            id: 'lib-1', name: 'TREC Residential Pack', kind: 'templates',
            semver: '1.0.0', schema: JSON.stringify({ sections: [] }),
            authorId: 'system', downloadCount: 0, featured: false,
            createdAt: new Date(), updatedAt: new Date(),
        } as never);
        await db.insert(schema.tenantLibraryImports).values({
            id: 'imp-1', tenantId: TENANT, libraryId: 'lib-1',
            importedSemver: '1.0.0', importedAt: new Date(), rowCount: 0,
            localEntityId,
        } as never);
    }

    async function addImportHistory(templateId: string) {
        await db.insert(schema.tenantMarketplaceImportHistory).values({
            id: 'hist-1', tenantId: TENANT, libraryId: 'lib-1', templateId,
            action: 'install', sourceVersion: null, targetVersion: '1.0.0',
            rowsAffected: 1, metadata: null, createdAt: new Date(), createdBy: 'system',
        } as never);
    }

    it('the fixture enforces foreign keys, so a guard case cannot pass vacuously', () => {
        // With the pragma OFF, a case meaning to observe a constraint would
        // instead observe the delete succeeding, and the assertion would be
        // measuring the absence of enforcement rather than the guard. Pinned so
        // that can never be silent. (better-sqlite3 turns it on by default; it
        // is asserted rather than assumed because the default is not ours.)
        expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
    });

    it('has exactly two foreign keys left pointing INTO templates', () => {
        // #307 expected a THIRD -- `tenant_marketplace_imports.local_template_id`
        // -- and built the marketplace refusal on top of it ("without this the
        // delete fails at the FK with a message naming neither the table nor
        // the row"). That table was retired with the legacy marketplace pair
        // (#293), which removed the only FK pointing into `templates` from the
        // marketplace side. The marketplace refusal below therefore rests on a
        // DIFFERENT harm, spelled out at its own case; this pins the premise so
        // the two cannot drift apart again.
        const fks = (['inspections', 'services', 'reports', 'tenant_library_imports'] as const)
            .filter(t => (sqlite.pragma(`foreign_key_list(${t})`) as Array<{ table: string }>)
                .some(fk => fk.table === 'templates'));
        expect(fks).toEqual(['inspections', 'services']);
    });

    it('refuses to delete a template a published report was generated from', async () => {
        // reports.template_id has no FK and no reader today -- grepping the tree
        // finds writes only, so the dangling pointer is inert. It is guarded
        // now precisely BECAUSE it is inert: the column's own comment calls it
        // "a denormalised pointer to the template this report was generated
        // from", which is a value meant to be read, and the repair after
        // somebody wires it up is a data-correction exercise rather than a check.
        await addReport('published', TEMPLATE_ID);
        await expect(svc.deleteTemplate(TEMPLATE_ID, TENANT)).rejects.toThrow(/Cannot delete/);
    });

    it('names the report that is blocking the delete', async () => {
        // Same standard the `services` refusal already sets: "Conflict" with no
        // subject sends a tenant hunting.
        await addReport('published', TEMPLATE_ID);
        await expect(svc.deleteTemplate(TEMPLATE_ID, TENANT))
            .rejects.toThrow(/Standard Home Inspection Report/);
    });

    it('is blocked by an unpublished report too', async () => {
        // The guard deliberately does not filter on status. An in-progress
        // report is a deliverable someone is mid-way through writing, and
        // pulling its structure out from under it is the same harm.
        await addReport('in_progress', TEMPLATE_ID);
        await expect(svc.deleteTemplate(TEMPLATE_ID, TENANT)).rejects.toThrow(/Cannot delete/);
    });

    it('refuses to delete the local copy a marketplace import still points at', async () => {
        // NOT because of a foreign key -- there is none on
        // tenant_library_imports.local_entity_id. The harm is that
        // `importCatalogEntry` is IDEMPOTENT ON THE MARKER: with the marker row
        // still present, re-importing the pack returns the DELETED id and
        // creates nothing, so the tenant cannot get the template back through
        // any button in the product.
        await addLibraryImport(TEMPLATE_ID);
        await expect(svc.deleteTemplate(TEMPLATE_ID, TENANT)).rejects.toThrow(/marketplace/i);
    });

    it('names the marketplace pack that is blocking the delete', async () => {
        await addLibraryImport(TEMPLATE_ID);
        await expect(svc.deleteTemplate(TEMPLATE_ID, TENANT))
            .rejects.toThrow(/TREC Residential Pack/);
    });

    it('does not refuse for an import marker pointing at some other template', async () => {
        // A 1:N import (a comments pack) leaves local_entity_id NULL, and a
        // 1:1 marker for a DIFFERENT template must not block this one. Without
        // this case the guard could be a blanket "any import row blocks any
        // delete" and still look green.
        await addLibraryImport('some-other-template');
        await expect(svc.deleteTemplate(TEMPLATE_ID, TENANT)).resolves.not.toThrow();
    });

    it('deletes despite an import-history row, on purpose', async () => {
        // tenant_marketplace_import_history.template_id is deliberately NOT
        // checked. History is meant to outlive what it describes.
        await addImportHistory(TEMPLATE_ID);
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
