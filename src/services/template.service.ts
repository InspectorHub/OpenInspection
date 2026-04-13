import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { templates, inspections } from '../lib/db/schema';
import { Errors } from '../lib/errors';

/**
 * Service to manage inspection templates.
 */
export class TemplateService {
    constructor(private db: D1Database) {}

    private getDrizzle() {
        return drizzle(this.db);
    }

    /**
     * Lists all templates for a tenant.
     */
    async listTemplates(tenantId: string) {
        const db = this.getDrizzle();
        return db.select({ id: templates.id, name: templates.name, version: templates.version })
            .from(templates)
            .where(eq(templates.tenantId, tenantId))
            .all();
    }

    /**
     * Fetches a single template by ID.
     */
    async getTemplate(id: string, tenantId: string) {
        const db = this.getDrizzle();
        const template = await db.select().from(templates)
            .where(and(eq(templates.id, id), eq(templates.tenantId, tenantId)))
            .get();
        if (!template) {
            throw Errors.NotFound('Template not found');
        }
        return template;
    }

    /**
     * Creates a new template.
     */
    async createTemplate(tenantId: string, name: string, schema: string | Record<string, unknown>) {
        const db = this.getDrizzle();
        const newTemplate = {
            id: crypto.randomUUID(),
            tenantId,
            name,
            version: 1,
            schema: typeof schema === 'string' ? schema : JSON.stringify(schema),
            createdAt: new Date(),
        };

        await db.insert(templates).values(newTemplate);
        return newTemplate;
    }

    /**
     * Updates an existing template, incrementing the version.
     */
    async updateTemplate(id: string, tenantId: string, name?: string, schema?: string | Record<string, unknown>) {
        const db = this.getDrizzle();
        const existing = await this.getTemplate(id, tenantId);

        const updateData = {
            name: name ??  existing.name,
            schema: schema ? (typeof schema === 'string' ? schema : JSON.stringify(schema)) : existing.schema,
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
