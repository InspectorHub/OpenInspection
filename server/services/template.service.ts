import { drizzle } from 'drizzle-orm/d1';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { eq, and, desc, sql, like } from 'drizzle-orm';
import { templates, inspections, services, reports, marketplaceLibraries, tenantLibraryImports } from '../lib/db/schema';
import { Errors } from '../lib/errors';
import { TemplateSchemaV2Schema } from '../lib/validations/template.schema';

/**
 * What is blocking a template delete, or null.
 *
 * `label` is the thing to NAME in the refusal — the service, the report title,
 * the marketplace pack. A "Conflict" with no subject sends a tenant hunting
 * through their inspections for a reference that is in their catalogue.
 */
export interface TemplateBlockingReference {
    kind:  'inspection' | 'service' | 'report' | 'marketplace_import';
    label: string | null;
}

/**
 * The ONE place that answers "may this template be deleted".
 *
 * A standalone function rather than a `TemplateService` method because the
 * second caller is a different service with its own db handle:
 * `TemplateService` resolves drizzle through `this.getDrizzle()` while
 * `TemplateMigrationService` holds `this.db` directly. Both pass their handle
 * in, because a second implementation of an authorization rule is a second
 * place for it to be wrong — which is exactly what
 * `template-migration.service.ts` was, checking `inspections` and nothing else.
 *
 * Order is deliberate: the two references a tenant is most likely to hit come
 * first, so the common refusal is also the cheapest.
 *
 * ⚠️ `tenant_marketplace_import_history.template_id` is deliberately NOT
 * checked. History is meant to outlive what it describes — "this tenant
 * installed pack X on this date" stays true after the local copy is gone — so a
 * dangling id there is correct rather than an oversight. Said here so it does
 * not read as the same miss as the four below.
 */
// Generic over the schema parameter, because the two callers do NOT hold the
// same drizzle type: `TemplateService.getDrizzle()` returns
// `DrizzleD1Database<Record<string, never>>` (drizzle called with no schema)
// while `TemplateMigrationService.db` is typed `ReturnType<typeof drizzle>`,
// i.e. `Record<string, unknown>`. A bare `DrizzleD1Database` binds the former
// and rejects the latter, which is the whole reason this is a shared function.
export async function findTemplateBlockingReference<TSchema extends Record<string, unknown>>(
    db: DrizzleD1Database<TSchema>,
    id: string,
    tenantId: string,
): Promise<TemplateBlockingReference | null> {
    // `inspections.template_id` is a REAL foreign key, and that is why this
    // check cannot be relaxed into "allow the delete when every referencing
    // inspection carries its own snapshot" — the question #307 set out to
    // re-ask once the live-template fallback was gone.
    //
    // The invariant: removing this check does not permit the delete. It moves
    // the refusal from a sentence naming the blocking row to
    // `FOREIGN KEY constraint failed`, which is the defect the `services` check
    // two blocks down exists to prevent. Permitting it for real means dropping
    // the FK, and D1 cannot rebuild a table an FK references. So this 409 is
    // the readable face of a constraint that is staying either way.
    //
    // Tidying an old catalogue is a soft-delete/archive feature, not a
    // relaxation of this gate.
    const usedBy = await db.select({ id: inspections.id })
        .from(inspections)
        .where(eq(inspections.templateId, id))
        .limit(1)
        .get();
    if (usedBy) return { kind: 'inspection', label: null };

    // `services.template_id` is the SECOND foreign key to this table, and it
    // was unchecked. Latent only while the services catalogue was empty —
    // seeding it ends that, and without this the delete fails at the FK with
    // a message naming neither the table nor the row.
    const usedByService = await db.select({ name: services.name })
        .from(services)
        .where(and(eq(services.templateId, id), eq(services.tenantId, tenantId)))
        .limit(1)
        .get();
    if (usedByService) return { kind: 'service', label: usedByService.name as string };

    // `reports.template_id` has no FK and, today, no reader — grepping the tree
    // finds writes only. The dangling pointer is therefore inert. It is guarded
    // now precisely BECAUSE it is inert: the column's own comment calls it "a
    // denormalised pointer to the template this report was generated from",
    // which is a value meant to be read, and the repair after somebody wires it
    // up is a data-correction exercise rather than a check.
    //
    // Deliberately not filtered on `status`: an in-progress report is a
    // deliverable someone is mid-way through writing, and pulling its structure
    // out from under it is the same harm as doing it to a published one.
    const usedByReport = await db.select({ title: reports.title })
        .from(reports)
        .where(and(eq(reports.templateId, id), eq(reports.tenantId, tenantId)))
        .limit(1)
        .get();
    if (usedByReport) return { kind: 'report', label: usedByReport.title as string };

    // `tenant_library_imports.local_entity_id` — the marketplace import marker.
    //
    // NOT a foreign key. The legacy `tenant_marketplace_imports` table (which
    // did carry one) was retired with the rest of the old marketplace pair,
    // taking the last FK from the marketplace side with it. The harm here is
    // different and worse than a raw constraint error: `importCatalogEntry` is
    // IDEMPOTENT ON THE MARKER, so with the marker still present a re-import of
    // the same pack returns the DELETED template id and creates nothing. The
    // tenant cannot get the template back through any button in the product.
    //
    // Name the pack. Joining `marketplace_libraries` for it costs one lookup on
    // a path that is about to refuse anyway.
    const usedByImport = await db.select({ name: marketplaceLibraries.name })
        .from(tenantLibraryImports)
        .leftJoin(marketplaceLibraries, eq(marketplaceLibraries.id, tenantLibraryImports.libraryId))
        .where(and(
            eq(tenantLibraryImports.localEntityId, id),
            eq(tenantLibraryImports.tenantId, tenantId),
        ))
        .limit(1)
        .get();
    if (usedByImport) return { kind: 'marketplace_import', label: (usedByImport.name as string) ?? null };

    return null;
}

/**
 * The refusal for one blocking reference.
 *
 * ⚠️ The `inspection` and `service` wordings are UNCHANGED from before the
 * lookup was extracted, and must stay that way:
 * `tests/unit/templates/template-delete-guard.spec.ts` pins them, and a
 * reworded message is a behaviour change wearing a refactor's clothes.
 */
function templateBlockedError(ref: TemplateBlockingReference) {
    switch (ref.kind) {
        case 'inspection':
            return Errors.Conflict('Cannot delete a template that is referenced by existing inspections');
        case 'service':
            return Errors.Conflict(`Cannot delete a template that is the default for the service "${ref.label}"`);
        case 'report':
            return Errors.Conflict(`Cannot delete a template that a report was generated from ("${ref.label}")`);
        case 'marketplace_import':
            return Errors.Conflict(
                ref.label
                    ? `Cannot delete a template that is the local copy of the marketplace pack "${ref.label}". Remove the import first, or the pack cannot be installed again.`
                    : 'Cannot delete a template that is still the local copy of a marketplace import. Remove the import first, or the pack cannot be installed again.',
            );
    }
}

/**
 * Derive the mirror columns from a validated v2 schema. Single source of truth:
 * the editor writes schema.propertyType / commercialSubtype; the templates row
 * columns are always recomputed from the schema on save. commercialSubtype is
 * only meaningful for commercial property types.
 */
export function deriveTemplateMirrorColumns(schema: Record<string, unknown>): {
    propertyType: string | null;
    commercialSubtype: string | null;
} {
    const pt = schema.propertyType;
    const cs = schema.commercialSubtype;
    const propertyType = typeof pt === 'string' && pt.length > 0 ? pt : null;
    const commercialSubtype = propertyType === 'commercial' && typeof cs === 'string' && cs.length > 0 ? cs : null;
    return { propertyType, commercialSubtype };
}

/**
 * Service to manage inspection templates.
 */
export class TemplateService {
    constructor(private db: D1Database) {}

    private getDrizzle() {
        return drizzle(this.db);
    }

    private countSchemaItems(schema: string | object | null | undefined): number {
        if (!schema) return 0;
        // Drizzle's `mode: 'json'` auto-parses on read so `schema` may already be an
        // object. Backfill SQL inserting raw TEXT keeps it as string. Tolerate both.
        let parsed: unknown;
        if (typeof schema === 'string') {
            try { parsed = JSON.parse(schema); } catch { return 0; }
        } else {
            parsed = schema;
        }
        if (Array.isArray(parsed)) return parsed.length;
        const sections = (parsed as { sections?: unknown })?.sections;
        if (Array.isArray(sections)) {
            return sections.reduce(
                (acc: number, sec) => acc + (Array.isArray((sec as { items?: unknown[] })?.items) ? (sec as { items: unknown[] }).items.length : 0),
                0
            );
        }
        return 0;
    }

    /**
     * Spec 5B — validate a template schema (v2). Throws AppError(BadRequest)
     * with a Zod-flattened message on failure. Used by create/update and by
     * MarketplaceService.importTemplate (Spec 5B P3 — gate v1 templates from
     * leaking into tenants via marketplace import).
     */
    validateSchema(schema: string | Record<string, unknown>): Record<string, unknown> {
        const parsed = typeof schema === 'string' ? (() => {
            try { return JSON.parse(schema) as unknown; }
            catch { throw Errors.BadRequest('Template schema is not valid JSON'); }
        })() : schema;
        const result = TemplateSchemaV2Schema.safeParse(parsed);
        if (!result.success) {
            const first = result.error.issues[0];
            const path = first?.path?.join('.') || 'schema';
            throw Errors.BadRequest(`Template schema invalid (v2 required): ${path} — ${first?.message ?? 'invalid'}`);
        }
        return result.data as unknown as Record<string, unknown>;
    }

    /**
     * Lists all templates for a tenant.
     */
    async listTemplates(tenantId: string, opts: { page?: number; pageSize?: number; q?: string } = {}) {
        const { page = 1, pageSize = 50, q } = opts;
        const db = this.getDrizzle();

        const baseWhere = eq(templates.tenantId, tenantId);
        const where = q?.trim() ? and(baseWhere, like(templates.name, `%${q.trim()}%`)) : baseWhere;

        const totalRow = await db
            .select({ c: sql<number>`count(*)` })
            .from(templates)
            .where(where)
            .get();
        const total = totalRow?.c ?? 0;

        const rows = await db.select({ id: templates.id, name: templates.name, version: templates.version, schema: templates.schema })
            .from(templates)
            .where(where)
            .orderBy(desc(templates.createdAt))
            .limit(pageSize)
            .offset((page - 1) * pageSize)
            .all();

        // The unified catalogue's import marker (#293). `local_entity_id` names
        // the ONE local row a 1:1 import produced; a 1:N import leaves it null
        // and is tracked by row_count instead, so those markers simply never
        // match a template id here.
        const { tenantLibraryImports } = await import('../lib/db/schema/marketplace');
        const imports = await db.select({
            localEntityId: tenantLibraryImports.localEntityId,
            libraryId:     tenantLibraryImports.libraryId,
        })
            .from(tenantLibraryImports)
            .where(eq(tenantLibraryImports.tenantId, tenantId))
            .all();
        const catalogIdByLocalId = new Map<string, string>();
        for (const i of imports) {
            if (i.localEntityId) catalogIdByLocalId.set(i.localEntityId as string, i.libraryId as string);
        }
        const mapped = rows.map(row => ({
            id: row.id,
            name: row.name,
            version: row.version,
            itemCount: this.countSchemaItems(row.schema as never),
            source: catalogIdByLocalId.has(row.id as string) ? 'marketplace' as const : 'custom' as const,
            marketplaceLibraryId: catalogIdByLocalId.get(row.id as string) ?? null,
        }));
        return { rows: mapped, total };
    }

    /**
     * Sub-spec B Task 9 (B-8) — find marketplace imports that have more than
     * one local copy in this tenant. Returns one entry per marketplace
     * template ID, each containing every local copy with id, name, version,
     * createdAt. The marketplace banner uses this to suggest
     * compare/use-new/keep-both actions.
     */
    async findDuplicates(tenantId: string): Promise<Array<{
        marketplaceId: string;
        copies: Array<{ id: string; name: string; version: string; createdAt: string }>;
    }>> {
        const db = this.getDrizzle();
        const { tenantLibraryImports } = await import('../lib/db/schema/marketplace');

        // Pull all catalogue imports for this tenant joined with the local
        // template's name + createdAt. We do this in two scans (imports
        // table + templates table) and bucket in-process — D1 doesn't support
        // CTEs reliably and the row count is small.
        const imports = await db.select({
            marketplaceId:   tenantLibraryImports.libraryId,
            localId:         tenantLibraryImports.localEntityId,
            importedSemver:  tenantLibraryImports.importedSemver,
            importedAt:      tenantLibraryImports.importedAt,
        })
            .from(tenantLibraryImports)
            .where(eq(tenantLibraryImports.tenantId, tenantId))
            .all();

        if (imports.length === 0) return [];

        // Group by catalogue entry id. A 1:N import has no local entity id and
        // cannot have "copies" in the templates table, so it is skipped rather
        // than bucketed under a null key.
        const groups = new Map<string, Array<{ localId: string; importedSemver: string; importedAt: string }>>();
        for (const imp of imports) {
            if (!imp.localId) continue;
            const key = imp.marketplaceId as string;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push({
                localId:        imp.localId as string,
                importedSemver: imp.importedSemver as string,
                importedAt:     (imp.importedAt as Date).toISOString(),
            });
        }

        // Only groups with > 1 copy are duplicates.
        const dupGroups = Array.from(groups.entries()).filter(([, copies]) => copies.length > 1);
        if (dupGroups.length === 0) return [];

        // Look up local template names in one query.
        const allLocalIds = dupGroups.flatMap(([, copies]) => copies.map(c => c.localId));
        const { inArray } = await import('drizzle-orm');
        const localRows = await db.select({ id: templates.id, name: templates.name })
            .from(templates)
            .where(and(eq(templates.tenantId, tenantId), inArray(templates.id, allLocalIds)))
            .all();
        const nameMap = new Map<string, string>();
        for (const r of localRows) nameMap.set(r.id as string, (r.name as string) || '(unnamed)');

        return dupGroups.map(([marketplaceId, copies]) => ({
            marketplaceId,
            copies: copies.map(c => ({
                id:        c.localId,
                name:      nameMap.get(c.localId) || '(unnamed)',
                version:   c.importedSemver,
                createdAt: c.importedAt,
            })),
        }));
    }

    /**
     * Fetches a single template by ID.
     */
    async getTemplate(id: string, tenantId: string) {
        const db = this.getDrizzle();
        const template = await db.select().from(templates).where(and(eq(templates.id, id), eq(templates.tenantId, tenantId))).get();
        if (!template) {
            throw Errors.NotFound('Template not found');
        }
        return template;
    }

    /**
     * Creates a new template. Spec 5B: schema MUST validate as v2.
     */
    async createTemplate(tenantId: string, name: string, schema: string | Record<string, unknown>) {
        const db = this.getDrizzle();
        const validated = this.validateSchema(schema);
        const mirror = deriveTemplateMirrorColumns(validated);
        const newTemplate = {
            id: crypto.randomUUID(),
            tenantId,
            name,
            version: 1,
            schema: JSON.stringify(validated),
            propertyType: mirror.propertyType,
            commercialSubtype: mirror.commercialSubtype,
            createdAt: new Date(),
        };

        await db.insert(templates).values(newTemplate);
        return newTemplate;
    }

    /**
     * Updates an existing template, incrementing the version.
     * Spec 5B: when schema is supplied it MUST validate as v2.
     */
    async updateTemplate(id: string, tenantId: string, name?: string, schema?: string | Record<string, unknown>, defaultProfileId?: string | null) {
        const db = this.getDrizzle();
        const existing = await this.getTemplate(id, tenantId);

        let nextSchema = existing.schema as string;
        let mirror: { propertyType: string | null; commercialSubtype: string | null } | null = null;
        if (schema !== undefined) {
            const validated = this.validateSchema(schema);
            nextSchema = JSON.stringify(validated);
            mirror = deriveTemplateMirrorColumns(validated);
        }

        const updateData: {
            name: string;
            schema: string;
            version: number;
            propertyType?: string | null;
            commercialSubtype?: string | null;
            defaultProfileId?: string | null;
        } = {
            name: name ?? (existing.name as string),
            schema: nextSchema,
            version: (existing.version as number) + 1,
        };
        if (mirror) {
            updateData.propertyType = mirror.propertyType;
            updateData.commercialSubtype = mirror.commercialSubtype;
        }
        if (defaultProfileId !== undefined) {
            updateData.defaultProfileId = defaultProfileId;
        }

        await db.update(templates).set(updateData).where(eq(templates.id, id));
        return { ...existing, ...updateData };
    }

    /**
     * Deletes a template, but only if nothing still references it.
     *
     * The four blocking references live in `findTemplateBlockingReference`,
     * which `TemplateMigrationService.tryDeleteOldTemplate` also calls — there
     * is one gate, not two.
     */
    async deleteTemplate(id: string, tenantId: string) {
        const db = this.getDrizzle();
        await this.getTemplate(id, tenantId);

        const blocking = await findTemplateBlockingReference(db, id, tenantId);
        if (blocking) throw templateBlockedError(blocking);

        await db.delete(templates).where(eq(templates.id, id));
    }
}
