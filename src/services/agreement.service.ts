import { drizzle } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { agreements, agreementRequests } from '../lib/db/schema';
import { Errors } from '../lib/errors';

/**
 * Service to manage tenant-specific agreement templates (signatures, terms).
 */
export class AgreementService {
    constructor(private db: D1Database) {}

    private getDrizzle() {
        return drizzle(this.db);
    }

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
        const newAgreement = {
            id: crypto.randomUUID(),
            tenantId,
            name,
            content,
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

        const updateData = {
            name: name ??  existing.name,
            content: content ??  existing.content,
            version: (existing.version as number) + 1,
        };

        await db.update(agreements).set(updateData).where(eq(agreements.id, id));
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

        await db.delete(agreements).where(eq(agreements.id, id));
    }

    /**
     * Creates a signing request and returns the token.
     */
    async createSigningRequest(tenantId: string, data: {
        agreementId: string;
        clientEmail: string;
        clientName?: string | null;
        inspectionId?: string | null;
    }) {
        const db = this.getDrizzle();
        const agreement = await db.select().from(agreements)
            .where(and(eq(agreements.id, data.agreementId), eq(agreements.tenantId, tenantId))).get();
        if (!agreement) throw Errors.NotFound('Agreement template not found');

        const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
        const request = {
            id: crypto.randomUUID(),
            tenantId,
            agreementId: data.agreementId,
            clientEmail: data.clientEmail,
            clientName: data.clientName ?? null,
            inspectionId: data.inspectionId ?? null,
            token,
            status: 'pending' as const,
            signatureBase64: null,
            signedAt: null,
            viewedAt: null,
            createdAt: new Date(),
        };
        await db.insert(agreementRequests).values(request);
        return { ...request, agreementName: agreement.name };
    }

    /**
     * Looks up a signing request by its public token (no tenant scope — token is the secret).
     */
    async getRequestByToken(token: string) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = drizzle(this.db as any);
        return db.select().from(agreementRequests).where(eq(agreementRequests.token, token)).get();
    }

    /**
     * Returns the agreement content for a given public token.
     */
    async getAgreementByToken(token: string) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = drizzle(this.db as any);
        const request = await db.select().from(agreementRequests).where(eq(agreementRequests.token, token)).get();
        if (!request) throw Errors.NotFound('Signing request not found');
        const agreement = await db.select().from(agreements).where(eq(agreements.id, request.agreementId)).get();
        if (!agreement) throw Errors.NotFound('Agreement not found');
        return { request, agreement };
    }

    /**
     * Marks a signing request as viewed (idempotent).
     */
    async markViewed(token: string) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = drizzle(this.db as any);
        const request = await db.select().from(agreementRequests).where(eq(agreementRequests.token, token)).get();
        if (!request) throw Errors.NotFound('Signing request not found');
        if (request.status === 'pending') {
            await db.update(agreementRequests)
                .set({ status: 'viewed', viewedAt: new Date() })
                .where(eq(agreementRequests.token, token));
        }
    }

    /**
     * Records a client signature on a signing request.
     */
    async signRequest(token: string, signatureBase64: string) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = drizzle(this.db as any);
        const request = await db.select().from(agreementRequests).where(eq(agreementRequests.token, token)).get();
        if (!request) throw Errors.NotFound('Signing request not found');
        if (request.status === 'signed') throw Errors.Conflict('Agreement already signed');

        await db.update(agreementRequests)
            .set({ status: 'signed', signatureBase64, signedAt: new Date() })
            .where(eq(agreementRequests.token, token));
        return { ...request, status: 'signed' as const, signatureBase64, signedAt: new Date() };
    }

    /**
     * Lists all signing requests for a tenant (most recent first).
     */
    async listRequests(tenantId: string) {
        const db = this.getDrizzle();
        return db.select().from(agreementRequests)
            .where(eq(agreementRequests.tenantId, tenantId))
            .all();
    }
}
