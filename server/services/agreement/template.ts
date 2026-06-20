import { eq, and } from 'drizzle-orm';
import { agreements } from '../../lib/db/schema';
import { Errors } from '../../lib/errors';
import { sanitizeAgreementHtml } from './sanitizer';
import { type Constructor } from './base';
import type { AgreementServiceBase } from './base';

/**
 * Tenant agreement-template CRUD (signatures, terms). Content is sanitized
 * through the shared HTML allow-list on every write.
 */
export function TemplateMixin<TBase extends Constructor<AgreementServiceBase>>(Base: TBase) {
    return class Template extends Base {
        protected declare getDrizzle: AgreementServiceBase['getDrizzle'];

        /**
         * Lists all agreement templates for a tenant.
         */
        async listAgreements(tenantId: string) {
            const db = this.getDrizzle();
            return db.select().from(agreements).where(eq(agreements.tenantId, tenantId)).all();
        }

        /**
         * Creates a new agreement template.
         */
        async createAgreement(tenantId: string, name: string, content: string) {
            const db = this.getDrizzle();
            const sanitizedContent = sanitizeAgreementHtml(content);
            const newAgreement = {
                id: crypto.randomUUID(),
                tenantId,
                name,
                content: sanitizedContent,
                version: 1,
                createdAt: new Date(),
            };
            await db.insert(agreements).values(newAgreement);
            return newAgreement;
        }

        /**
         * Updates an existing agreement template, incrementing the version.
         */
        async updateAgreement(id: string, tenantId: string, name?: string, content?: string) {
            const db = this.getDrizzle();
            const existing = await db.select().from(agreements).where(and(eq(agreements.id, id), eq(agreements.tenantId, tenantId))).get();

            if (!existing) {
                throw Errors.NotFound('Agreement template not found');
            }

            const sanitizedContent = content !== undefined ? sanitizeAgreementHtml(content) : existing.content;
            const updateData = {
                name: name ??  existing.name,
                content: sanitizedContent,
                version: (existing.version as number) + 1,
            };

            await db.update(agreements).set(updateData).where(and(eq(agreements.id, id), eq(agreements.tenantId, tenantId)));
            return { ...existing, ...updateData };
        }

        /**
         * Deletes an agreement template.
         */
        async deleteAgreement(id: string, tenantId: string) {
            const db = this.getDrizzle();
            const existing = await db.select().from(agreements).where(and(eq(agreements.id, id), eq(agreements.tenantId, tenantId))).get();

            if (!existing) {
                throw Errors.NotFound('Agreement template not found');
            }

            await db.delete(agreements).where(and(eq(agreements.id, id), eq(agreements.tenantId, tenantId)));
        }
    };
}
