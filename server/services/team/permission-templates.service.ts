import { drizzle } from 'drizzle-orm/d1';
import { and, eq, isNull, asc } from 'drizzle-orm';
import { permissionTemplates } from '../../lib/db/schema';
import { Errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { assertMayGrant, type GrantActor } from '../../lib/auth/grant-ceiling';
import type { PermissionOverrides } from '../../lib/auth/capabilities';
import { coerceOverrides } from '../../lib/auth/capabilities';
import {
    MAX_COMPANY_TEMPLATES, MAX_TEMPLATE_NAME_LENGTH, findSystemTemplate, diffAgainstRole,
    isTemplateRole, resolveCompanyTemplate, resolveTemplate, toCompanyTemplate,
    type CompanyTemplate, type ResolvedTemplate, type TemplateRole,
} from '../../lib/auth/permission-templates';

/** A template the caller asked to apply, resolved to what gets stamped, plus the name to record. */
export interface AppliedTemplate extends ResolvedTemplate {
    /** `key` of a system template or `id` of a company one. */
    ref: string;
    /** The template's name. Recorded in the audit trail; never a person's details. */
    name: string;
    system: boolean;
}

export interface TemplateInput {
    name: string;
    baseRole: TemplateRole;
    overrides?: Partial<Record<string, boolean | undefined>> | null | undefined;
}

const isMissingTable = (err: unknown) => err instanceof Error && /no such table/i.test(err.message);

function normaliseName(raw: string): string {
    const name = raw.trim().replace(/\s+/g, ' ');
    if (name.length === 0) throw Errors.BadRequest('A template needs a name.');
    if (name.length > MAX_TEMPLATE_NAME_LENGTH) {
        throw Errors.BadRequest(`A template name can be at most ${MAX_TEMPLATE_NAME_LENGTH} characters.`);
    }
    return name;
}

/**
 * A company's own permission templates ("custom roles"), and the lookup that turns a
 * template reference from an invite or a member edit into the role and switch diff to
 * stamp.
 *
 * The grant ceiling applies to what a template CONTAINS, not just to what is applied
 * later: a manager cannot save a template that switches on something the manager does
 * not hold, so a template cannot be used to launder a grant. Owners are unrestricted.
 *
 * Every query filters on the tenant id taken from the verified session.
 */
export class PermissionTemplateService {
    constructor(private db: D1Database) {}

    private getDB() {
        return drizzle(this.db);
    }

    /** The company's live (not archived) templates, oldest first. Empty, not an error, while the table is not there yet. */
    async list(tenantId: string): Promise<CompanyTemplate[]> {
        try {
            const rows = await this.getDB().select().from(permissionTemplates)
                .where(and(eq(permissionTemplates.tenantId, tenantId), isNull(permissionTemplates.archivedAt)))
                .orderBy(asc(permissionTemplates.createdAt), asc(permissionTemplates.id));
            return rows.flatMap((r) => {
                const t = toCompanyTemplate(r);
                return t ? [t] : [];
            });
        } catch (err) {
            // The code can be deployed a moment before its migration. The page must still load.
            if (isMissingTable(err)) {
                logger.warn('permission_templates is not present yet; listing no company templates');
                return [];
            }
            throw err;
        }
    }

    async get(tenantId: string, id: string): Promise<CompanyTemplate> {
        const row = await this.getDB().select().from(permissionTemplates)
            .where(and(eq(permissionTemplates.id, id), eq(permissionTemplates.tenantId, tenantId), isNull(permissionTemplates.archivedAt)))
            .get();
        const t = row ? toCompanyTemplate(row) : null;
        if (!t) throw Errors.NotFound('Permission template not found');
        return t;
    }

    /** Everything that must hold before a template's content is saved. Returns the diff to store. */
    private checkContent(actor: GrantActor, baseRole: string, overrides: TemplateInput['overrides']): PermissionOverrides {
        if (!isTemplateRole(baseRole)) {
            throw Errors.BadRequest('A template is based on the manager, inspector or staff role.');
        }
        const diff = diffAgainstRole(baseRole, coerceOverrides(overrides ?? null));
        assertMayGrant(actor, { from: null, to: { role: baseRole, overrides: diff } });
        return diff ?? {};
    }

    private async assertNameFree(tenantId: string, name: string, exceptId?: string): Promise<void> {
        const rows = await this.getDB().select({ id: permissionTemplates.id }).from(permissionTemplates)
            .where(and(eq(permissionTemplates.tenantId, tenantId), eq(permissionTemplates.name, name), isNull(permissionTemplates.archivedAt)));
        if (rows.some((r) => r.id !== exceptId)) throw Errors.Conflict('A permission template with this name already exists.');
    }

    async create(tenantId: string, actor: GrantActor, input: TemplateInput, createdBy: string | null): Promise<CompanyTemplate> {
        const name = normaliseName(input.name);
        const overrides = this.checkContent(actor, input.baseRole, input.overrides);
        const live = await this.list(tenantId);
        if (live.length >= MAX_COMPANY_TEMPLATES) {
            throw Errors.Conflict(`A company can keep at most ${MAX_COMPANY_TEMPLATES} permission templates. Archive one you no longer use first.`);
        }
        await this.assertNameFree(tenantId, name);
        const id = crypto.randomUUID();
        const now = new Date();
        try {
            await this.getDB().insert(permissionTemplates).values({
                id, tenantId, name, baseRole: input.baseRole as TemplateRole, overrides, createdBy, createdAt: now, updatedAt: now,
            });
        } catch (err) {
            // Two saves with the same name at once: the partial unique index is the arbiter.
            if (err instanceof Error && /UNIQUE/i.test(err.message)) throw Errors.Conflict('A permission template with this name already exists.');
            throw err;
        }
        return { id, name, baseRole: input.baseRole, overrides: coerceOverrides(overrides) };
    }

    async update(tenantId: string, actor: GrantActor, id: string, input: TemplateInput): Promise<CompanyTemplate> {
        await this.get(tenantId, id);
        const name = normaliseName(input.name);
        const overrides = this.checkContent(actor, input.baseRole, input.overrides);
        await this.assertNameFree(tenantId, name, id);
        try {
            await this.getDB().update(permissionTemplates)
                .set({ name, baseRole: input.baseRole as TemplateRole, overrides, updatedAt: new Date() })
                .where(and(eq(permissionTemplates.id, id), eq(permissionTemplates.tenantId, tenantId), isNull(permissionTemplates.archivedAt)));
        } catch (err) {
            if (err instanceof Error && /UNIQUE/i.test(err.message)) throw Errors.Conflict('A permission template with this name already exists.');
            throw err;
        }
        return { id, name, baseRole: input.baseRole, overrides: coerceOverrides(overrides) };
    }

    /** Archive, never delete: people who received the template keep what was stamped, and the name can be reused. */
    async archive(tenantId: string, id: string): Promise<CompanyTemplate> {
        const existing = await this.get(tenantId, id);
        await this.getDB().update(permissionTemplates)
            .set({ archivedAt: new Date(), updatedAt: new Date() })
            .where(and(eq(permissionTemplates.id, id), eq(permissionTemplates.tenantId, tenantId), isNull(permissionTemplates.archivedAt)));
        return existing;
    }

    /**
     * Resolves a `templateId` from an invite or member edit: a system key or a company
     * template id of THIS company. Anything else, including another company's id, is a 404.
     * The grant ceiling is applied by the caller's invite or update path on the result.
     */
    async resolveRef(tenantId: string, ref: string): Promise<AppliedTemplate> {
        const system = findSystemTemplate(ref);
        if (system) return { ...resolveTemplate(system.key), ref: system.key, name: system.name, system: true };
        let company: CompanyTemplate;
        try {
            company = await this.get(tenantId, ref);
        } catch (err) {
            if (isMissingTable(err)) throw Errors.NotFound('Permission template not found');
            throw err;
        }
        return { ...resolveCompanyTemplate(company), ref: company.id, name: company.name, system: false };
    }
}
