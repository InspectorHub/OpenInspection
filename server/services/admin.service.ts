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
    agreementRequests,
    agreementSigners,
    tenants,
    tenantConfigs,
    calendarConnections,
    contacts,
    inspectionPeople,
} from '../lib/db/schema';
import { Errors } from '../lib/errors';
import { runErasure } from '../lib/compliance/erasure-orchestrator';
import type { Role } from '../lib/auth/roles';

import { IntegrationProvider, TenantUpdateParams } from '../lib/integration';
import { safeTimestamp } from '../lib/date';

/** A workspace member plus the freshness of their Google calendar sync. */
export interface MemberWithCalendarSync {
    id: string;
    email: string;
    role: string;
    createdAt: Date;
    calendarConnected: boolean;
    /** Epoch ms of the last successful busy pull; null when never synced. */
    calendarLastSyncAt: number | null;
}

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
     * Lists all workspace members and pending invitations, each carrying its
     * Google calendar-sync freshness.
     *
     * @see MemberWithCalendarSync — the row shape, exported so route handlers
     * do not hand-copy it.
     *
     * The sync lookup is a separate keyed read rather than a join: callers use
     * this list as an authorization roster, so a row multiplied by a join would
     * be a correctness bug, not just a display one.
     */
    async getMembers(tenantId: string) {
        const db = this.getDrizzle();
        const [members, invites, connections] = await Promise.all([
            db.select({ id: users.id, email: users.email, role: users.role, createdAt: users.createdAt })
                .from(users)
                .where(eq(users.tenantId, tenantId)),
            db.select().from(tenantInvites).where(eq(tenantInvites.tenantId, tenantId)),
            db.select({
                userId: calendarConnections.userId,
                lastSyncAt: calendarConnections.lastSyncAt,
            })
                .from(calendarConnections)
                .where(dbAnd(
                    eq(calendarConnections.tenantId, tenantId),
                    eq(calendarConnections.provider, 'google'),
                )),
        ]);

        const syncByUser = new Map(connections.map((c) => [c.userId, c.lastSyncAt]));
        return {
            members: members.map((m) => ({
                ...m,
                calendarConnected: syncByUser.has(m.id),
                calendarLastSyncAt: syncByUser.get(m.id)?.getTime() ?? null,
            })),
            invites,
        };
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
            role: role as Role,
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
        // Track I-a — the live agreement evidence (envelopes + per-signer records).
        // Columns are projected EXPLICITLY so token material (token / token_hash /
        // token_enc) is never serialized into a data-subject export, mirroring the
        // observer/guest list-projection posture. `select()` (star) on these tables
        // would leak the token columns.
        const [tenantInspections, tenantTemplates, tenantAgreements, tenantAgreementRequests, tenantAgreementSigners] = await Promise.all([
            db.select().from(inspections).where(eq(inspections.tenantId, tenantId)),
            db.select().from(templates).where(eq(templates.tenantId, tenantId)),
            db.select().from(agreements).where(eq(agreements.tenantId, tenantId)),
            db.select({
                id: agreementRequests.id,
                inspectionId: agreementRequests.inspectionId,
                agreementId: agreementRequests.agreementId,
                clientEmail: agreementRequests.clientEmail,
                clientName: agreementRequests.clientName,
                status: agreementRequests.status,
                signatureBase64: agreementRequests.signatureBase64,
                signedAt: agreementRequests.signedAt,
                viewedAt: agreementRequests.viewedAt,
                sentAt: agreementRequests.sentAt,
                inspectorSignatureBase64: agreementRequests.inspectorSignatureBase64,
                inspectorSignedAt: agreementRequests.inspectorSignedAt,
                // Public verifier token — printed on the signed PDF / QR code so
                // anyone can verify the seal; deliberately included (NOT auth
                // material). The auth columns (token / tokenHash / tokenEnc) are
                // intentionally NOT projected here — see the star-select caveat above.
                verificationToken: agreementRequests.verificationToken,
                contentSnapshot: agreementRequests.contentSnapshot,
                contentHash: agreementRequests.contentHash,
                completionPolicy: agreementRequests.completionPolicy,
                purgedAt: agreementRequests.purgedAt,
                createdAt: agreementRequests.createdAt,
            }).from(agreementRequests).where(eq(agreementRequests.tenantId, tenantId)),
            db.select({
                id: agreementSigners.id,
                requestId: agreementSigners.requestId,
                name: agreementSigners.name,
                email: agreementSigners.email,
                role: agreementSigners.role,
                contactId: agreementSigners.contactId,
                status: agreementSigners.status,
                signatureBase64: agreementSigners.signatureBase64,
                signedAt: agreementSigners.signedAt,
                viewedAt: agreementSigners.viewedAt,
                ipAddress: agreementSigners.ipAddress,
                userAgent: agreementSigners.userAgent,
                channel: agreementSigners.channel,
                onBehalfOf: agreementSigners.onBehalfOf,
                onBehalfDisclaimer: agreementSigners.onBehalfDisclaimer,
                lastRemindedAt: agreementSigners.lastRemindedAt,
                createdAt: agreementSigners.createdAt,
            }).from(agreementSigners).where(eq(agreementSigners.tenantId, tenantId)),
        ]);

        const inspectionIds = tenantInspections.map((i) => i.id);
        let results: Record<string, unknown>[] = [];

        if (inspectionIds.length > 0) {
            [results] = await Promise.all([
                db.select().from(inspectionResults).where(dbAnd(inArray(inspectionResults.inspectionId, inspectionIds), eq(inspectionResults.tenantId, tenantId))),
            ]);
        }

        return {
            inspections: tenantInspections,
            templates: tenantTemplates,
            agreements: tenantAgreements,
            inspectionResults: results,
            // Live multi-signer agreement evidence (token material projected out).
            agreementRequests: tenantAgreementRequests,
            agreementSigners: tenantAgreementSigners,
        };
    }

    /**
     * Performs GDPR-compliant erasure of a client's personal data (Track I-a).
     *
     * Delegates to the manifest-driven {@link runErasure} orchestrator, which
     * anonymizes signed-agreement satellite PII (keeping the signature + audit
     * chain under the Art. 17(3)(e) exemption), deletes draft envelopes, nulls
     * non-agreement client columns, and writes one append-only `erasure_log`
     * decision row. The retention window comes from
     * `tenant_configs.agreement_retention_years`.
     *
     * Return shape is ADDITIVE: legacy `{ matched, deletedAgreements }` fields
     * are preserved for existing callers, alongside the richer orchestrator
     * summary `{ status, anonymizedCount, deletedCount, retainedCount,
     * decisions, logId }`.
     */
    async eraseClientData(tenantId: string, clientEmail: string, opts?: { requestedBy?: string; identityBasis?: string }) {
        const db = this.getDrizzle();

        // How many inspections this subject is on — sourced from the LIVE
        // client-identity path (inspection_people -> contacts), not the frozen
        // `inspections.client_email` cache (dropped in a later migration).
        // Preserves the legacy `matched`/`deletedAgreements` contract for
        // existing callers.
        const matchedRows = await db.select({ id: inspectionPeople.inspectionId })
            .from(inspectionPeople)
            .innerJoin(contacts, dbAnd(
                eq(contacts.id, inspectionPeople.contactId),
                eq(contacts.tenantId, tenantId),
            ))
            .where(dbAnd(eq(inspectionPeople.tenantId, tenantId), eq(contacts.email, clientEmail)));
        const matchedIds = [...new Set(matchedRows.map((r) => r.id))];

        // Per-tenant retention window (default 6) from tenant_configs.
        const cfg = await db.select({ years: tenantConfigs.agreementRetentionYears })
            .from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantId)).get();
        const retentionYears = cfg?.years ?? 6;

        const summary = await runErasure(db, {
            tenantId,
            subjectEmail: clientEmail,
            retentionYears,
            ...(opts?.requestedBy ? { requestedBy: opts.requestedBy } : {}),
            identityBasis: opts?.identityBasis ?? 'admin_action',
        });

        return {
            // Legacy additive fields.
            matched: matchedIds.length,
            deletedAgreements: matchedIds.length,
            // Richer orchestrator summary.
            ...summary,
        };
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

    // updateStripeConnect (slug-keyed M2M write) was removed with its only
    // caller, the dead POST /api/integration/tenants/:slug/stripe-connect
    // endpoint (A-21 batch 3 adjudication). Inspector-facing setStripeConnect
    // below is the live write path.

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

