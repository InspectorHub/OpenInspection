import { drizzle } from 'drizzle-orm/d1';
import { eq, inArray, desc, and as dbAnd, or as dbOr, lt as dbLt } from 'drizzle-orm';
import {
    users,
    tenantInvites,
    auditLogs,
    agreements,
    inspections,
    inspectionResults,
    templates,
    inspectionAgreements,
    tenants,
} from '../lib/db/schema';
import { Errors } from '../lib/errors';

import { IntegrationProvider, TenantUpdateParams } from '../lib/integration';
import { safeTimestamp } from '../lib/date';

/**
 * Service to handle administrative tasks such as member management, 
 * data compliance, and infrastructure configuration.
 */
export class AdminService {
    constructor(
        private db: D1Database, 
        private integration?: IntegrationProvider
    ) {}

    private getDrizzle() {
        return drizzle(this.db);
    }

    /**
     * Lists all workspace members and pending invitations.
     */
    async getMembers(tenantId: string) {
        const db = this.getDrizzle();
        const [members, invites] = await Promise.all([
            db.select({ id: users.id, email: users.email, role: users.role, createdAt: users.createdAt })
                .from(users)
                .where(eq(users.tenantId, tenantId)),
            db.select().from(tenantInvites).where(eq(tenantInvites.tenantId, tenantId)),
        ]);
        return { members, invites };
    }

    /**
     * Creates a team invitation.
     */
    async createInvite(tenantId: string, email: string, role: string) {
        const db = this.getDrizzle();
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        const inviteId = crypto.randomUUID();

        await db.insert(tenantInvites).values({
            id: inviteId,
            tenantId,
            email,
            role: role as 'owner' | 'admin' | 'inspector' | 'agent' | 'viewer',
            status: 'pending',
            expiresAt,
        });

        return { inviteId, expiresAt };
    }

    /**
     * Exports all tenant-scoped data in a standardized JSON format.
     */
    async getExport(tenantId: string) {
        const db = this.getDrizzle();
        const [tenantInspections, tenantTemplates, tenantAgreements] = await Promise.all([
            db.select().from(inspections).where(eq(inspections.tenantId, tenantId)),
            db.select().from(templates).where(eq(templates.tenantId, tenantId)),
            db.select().from(agreements).where(eq(agreements.tenantId, tenantId)),
        ]);

        const inspectionIds = tenantInspections.map((i) => i.id);
        let results: Record<string, unknown>[] = [];
        let signers: Record<string, unknown>[] = [];

        if (inspectionIds.length > 0) {
            [results, signers] = await Promise.all([
                db.select().from(inspectionResults).where(dbAnd(inArray(inspectionResults.inspectionId, inspectionIds), eq(inspectionResults.tenantId, tenantId))),
                db.select().from(inspectionAgreements).where(dbAnd(inArray(inspectionAgreements.inspectionId, inspectionIds), eq(inspectionAgreements.tenantId, tenantId))),
            ]);
        }

        return {
            inspections: tenantInspections,
            templates: tenantTemplates,
            agreements: tenantAgreements,
            inspectionResults: results,
            inspectionAgreements: signers
        };
    }

    /**
     * Perfroms GDPR-compliant erasure of client personal data.
     */
    async eraseClientData(tenantId: string, clientEmail: string) {
        const db = this.getDrizzle();
        const matched = await db.select({ id: inspections.id })
            .from(inspections)
            .where(dbAnd(eq(inspections.tenantId, tenantId), eq(inspections.clientEmail, clientEmail)));

        const matchedIds = matched.map((r) => r.id);
        if (matchedIds.length === 0) return { matched: 0, deletedAgreements: 0 };

        await db.delete(inspectionAgreements).where(dbAnd(inArray(inspectionAgreements.inspectionId, matchedIds), eq(inspectionAgreements.tenantId, tenantId)));
        await db.update(inspections).set({ clientName: null, clientEmail: null })
            .where(dbAnd(eq(inspections.tenantId, tenantId), eq(inspections.clientEmail, clientEmail)));

        return { matched: matchedIds.length, deletedAgreements: matchedIds.length };
    }

    /**
     * Lists paginated audit logs for the tenant.
     */
    async getAuditLogs(tenantId: string, params: { limit: number; cursor?: string; action?: string; entityType?: string }) {
        const db = this.getDrizzle();
        const conditions = [eq(auditLogs.tenantId, tenantId)];
        
        if (params.action) conditions.push(eq(auditLogs.action, params.action as 'tenant.create' | 'inspection.create'));
        if (params.entityType) conditions.push(eq(auditLogs.entityType, params.entityType));

        if (params.cursor) {
            try {
                const p = JSON.parse(atob(params.cursor));
                const d = new Date(p.createdAt);
                conditions.push(dbOr(dbLt(auditLogs.createdAt, d), dbAnd(eq(auditLogs.createdAt, d), dbLt(auditLogs.id, p.id)))!);
            } catch { throw Errors.BadRequest('Invalid cursor'); }
        }

        const rows = await db.select().from(auditLogs)
            .where(dbAnd(...conditions))
            .orderBy(desc(auditLogs.createdAt))
            .limit(params.limit + 1);

        const hasMore = rows.length > params.limit;
        const page = hasMore ? rows.slice(0, params.limit) : rows;
        let nextCursor: string | null = null;
        if (hasMore) {
            const last = page[page.length - 1];
            nextCursor = btoa(JSON.stringify({ createdAt: safeTimestamp(last.createdAt), id: last.id }));
        }

        return { logs: page, nextCursor, hasMore };
    }

    /**
     * Updates tenant status and tier. Uses the integration provider to handle logic.
     */
    async updateTenantStatus(params: TenantUpdateParams) {
        if (!this.integration) {
            throw new Error('IntegrationProvider not configured');
        }
        await this.integration.handleTenantUpdate(params);
    }

    /**
     * Alias for updateTenantStatus used during initial system setup.
     */
    async handleTenantUpdate(params: TenantUpdateParams) {
        return this.updateTenantStatus(params);
    }

    /**
     * Connects a Stripe account for the tenant.
     */
    async updateStripeConnect(subdomain: string, accountId: string) {
        if (!this.integration?.handleStripeConnect) {
            throw new Error('IntegrationProvider not configured or does not support Stripe Connect');
        }
        await this.integration.handleStripeConnect(subdomain, accountId);
    }

    /**
     * Reads the tenant's Stripe Connect account ID (inspector-facing, JWT-scoped).
     */
    async getStripeConnect(tenantId: string): Promise<{ accountId: string | null }> {
        const db = this.getDrizzle();
        const row = await db.select({ id: tenants.stripeConnectAccountId })
            .from(tenants).where(eq(tenants.id, tenantId)).get();
        return { accountId: row?.id ?? null };
    }

    /**
     * Sets or clears the tenant's Stripe Connect account ID directly (inspector-facing, JWT-scoped).
     */
    async setStripeConnect(tenantId: string, accountId: string | null): Promise<void> {
        const db = this.getDrizzle();
        await db.update(tenants).set({ stripeConnectAccountId: accountId })
            .where(eq(tenants.id, tenantId));
    }
}

