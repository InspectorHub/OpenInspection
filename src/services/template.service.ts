import { drizzle } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { templates, inspections } from '../lib/db/schema';
import { Errors } from '../lib/errors';
import { TemplateSchemaV2Schema } from '../lib/validations/template.schema';

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
    async listTemplates(tenantId: string) {
        const db = this.getDrizzle();
        const rows = await db.select({ id: templates.id, name: templates.name, version: templates.version, schema: templates.schema })
            .from(templates)
            .where(eq(templates.tenantId, tenantId))
            .all();
        // Round 4 polish — surface marketplace-import flag so UI can tag rows.
        const { tenantMarketplaceImports } = await import('../lib/db/schema/marketplace');
        const imports = await db.select({ localTemplateId: tenantMarketplaceImports.localTemplateId })
            .from(tenantMarketplaceImports)
            .where(eq(tenantMarketplaceImports.tenantId, tenantId))
            .all();
        const importedIds = new Set(imports.map(i => i.localTemplateId as string));
        return rows.map(row => ({
            id: row.id,
            name: row.name,
            version: row.version,
            itemCount: this.countSchemaItems(row.schema as never),
            source: importedIds.has(row.id as string) ? 'marketplace' as const : 'custom' as const,
        }));
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
        const { tenantMarketplaceImports } = await import('../lib/db/schema/marketplace');

        // Pull all marketplace imports for this tenant joined with the local
        // template's name + createdAt. We do this in two scans (imports
        // table + templates table) and bucket in-process — D1 doesn't support
        // CTEs reliably and the row count is small.
        const imports = await db.select({
            marketplaceId:   tenantMarketplaceImports.marketplaceTemplateId,
            localId:         tenantMarketplaceImports.localTemplateId,
            importedSemver:  tenantMarketplaceImports.importedSemver,
            importedAt:      tenantMarketplaceImports.importedAt,
        })
            .from(tenantMarketplaceImports)
            .where(eq(tenantMarketplaceImports.tenantId, tenantId))
            .all();

        if (imports.length === 0) return [];

        // Group by marketplaceId.
        const groups = new Map<string, Array<{ localId: string; importedSemver: string; importedAt: string }>>();
        for (const imp of imports) {
            const key = imp.marketplaceId as string;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push({
                localId:        imp.localId as string,
                importedSemver: imp.importedSemver as string,
                importedAt:     imp.importedAt as string,
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
        const newTemplate = {
            id: crypto.randomUUID(),
            tenantId,
            name,
            version: 1,
            schema: JSON.stringify(validated),
            createdAt: new Date(),
        };

        await db.insert(templates).values(newTemplate);
        return newTemplate;
    }

    /**
     * Updates an existing template, incrementing the version.
     * Spec 5B: when schema is supplied it MUST validate as v2.
     */
    async updateTemplate(id: string, tenantId: string, name?: string, schema?: string | Record<string, unknown>) {
        const db = this.getDrizzle();
        const existing = await this.getTemplate(id, tenantId);

        const nextSchema = schema !== undefined
            ? JSON.stringify(this.validateSchema(schema))
            : existing.schema;

        const updateData = {
            name: name ??  existing.name,
            schema: nextSchema,
            version: (existing.version as number) + 1,
        };

        await db.update(templates).set(updateData).where(eq(templates.id, id));
        return { ...existing, ...updateData };
    }

    /**
     * Deletes a template, but only if it's not and-referenced by any inspections.
     */
    async deleteTemplate(id: string, tenantId: string) {
        const db = this.getDrizzle();
        await this.getTemplate(id, tenantId);

        // Check for references
        const usedBy = await db.select({ id: inspections.id })
            .from(inspections)
            .where(eq(inspections.templateId, id))
            .limit(1)
            .get();

        if (usedBy) {
            throw Errors.Conflict('Cannot delete a template that is referenced by existing inspections');
        }

        await db.delete(templates).where(eq(templates.id, id));
    }
}
