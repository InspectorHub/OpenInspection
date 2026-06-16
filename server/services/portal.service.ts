/**
 * Unified client portal — read-side aggregation service.
 *
 * Two responsibilities, both pure reads over EXISTING tables (no portal table):
 *   1. `listRecipientInspections` — every inspection a recipient email can see
 *      via a live `inspectionAccessTokens` grant (client / co_client only;
 *      agent grants are out of scope for the client hub).
 *   2. `hubOverview` — a 6-dimension status snapshot for one inspection used by
 *      the portal landing card (status / agreement / payment / report / progress
 *      / unread messages).
 *
 * Multi-tenant: EVERY query filters by tenantId explicitly (see CLAUDE.md).
 */
import { drizzle } from 'drizzle-orm/d1';
import { and, eq, inArray, isNull, or, gt } from 'drizzle-orm';
import { inspectionAccessTokens, inspections, agreementRequests, customerMessages } from '../lib/db/schema';
import { isReportPublished } from '../lib/status/report-status';

interface ObserveProgressLike {
    getObserveProgress: (
        inspectionId: string,
        tenantId: string,
    ) => Promise<{ sections: Array<{ totalItems: number; completedItems: number }> }>;
}

export interface RecipientInspection {
    inspectionId: string;
    address: string;
    date: string;
    inspectionStatus: string;
    reportPublished: boolean;
    paymentStatus: string;
}

export interface HubOverview {
    address: string;
    date: string;
    inspectionStatus: string;
    agreementSigned: boolean;
    paymentStatus: string;
    reportPublished: boolean;
    progress: { completed: number; total: number };
    unreadMessages: number;
}

export class PortalService {
    constructor(
        private db: D1Database,
        private inspectionSvc: ObserveProgressLike,
    ) {}

    private d() {
        return drizzle(this.db);
    }

    /**
     * Inspections this recipient can access via a live (non-revoked,
     * non-expired) client / co_client token. Deduplicated by inspection id.
     */
    async listRecipientInspections(tenantId: string, email: string): Promise<RecipientInspection[]> {
        const db = this.d();
        const now = Date.now();

        const grants = await db
            .select({ inspectionId: inspectionAccessTokens.inspectionId })
            .from(inspectionAccessTokens)
            .where(
                and(
                    eq(inspectionAccessTokens.tenantId, tenantId),
                    eq(inspectionAccessTokens.recipientEmail, email),
                    inArray(inspectionAccessTokens.role, ['client', 'co_client']),
                    isNull(inspectionAccessTokens.revokedAt),
                    // A grant is live only when not yet expired. `expiresAt` is
                    // epoch ms (NULL = never expires), consistent with Date.now().
                    // Mirrors resolvePortalAccess (server/lib/public-access.ts).
                    or(isNull(inspectionAccessTokens.expiresAt), gt(inspectionAccessTokens.expiresAt, now)),
                ),
            );

        const ids = [...new Set(grants.map((g) => g.inspectionId))];
        if (ids.length === 0) return [];

        const rows = await db
            .select()
            .from(inspections)
            .where(and(eq(inspections.tenantId, tenantId), inArray(inspections.id, ids)));

        return rows.map((r) => ({
            inspectionId: r.id,
            address: r.propertyAddress,
            date: r.date,
            inspectionStatus: r.status,
            reportPublished: isReportPublished(r.reportStatus),
            paymentStatus: r.paymentStatus,
        }));
    }

    /**
     * 6-dimension status snapshot for one inspection. Returns null if the
     * inspection does not exist under this tenant.
     */
    async hubOverview(tenantId: string, inspectionId: string): Promise<HubOverview | null> {
        const db = this.d();

        const insp = await db
            .select()
            .from(inspections)
            .where(and(eq(inspections.tenantId, tenantId), eq(inspections.id, inspectionId)))
            .get();

        if (!insp) return null;

        const signed = await db
            .select({ id: agreementRequests.id })
            .from(agreementRequests)
            .where(
                and(
                    eq(agreementRequests.tenantId, tenantId),
                    eq(agreementRequests.inspectionId, inspectionId),
                    eq(agreementRequests.status, 'signed'),
                ),
            )
            .get();

        const unread = await db
            .select({ id: customerMessages.id })
            .from(customerMessages)
            .where(
                and(
                    eq(customerMessages.tenantId, tenantId),
                    eq(customerMessages.inspectionId, inspectionId),
                    isNull(customerMessages.readAt),
                    eq(customerMessages.fromRole, 'inspector'),
                ),
            );

        let progress = { completed: 0, total: 0 };
        try {
            const observed = await this.inspectionSvc.getObserveProgress(inspectionId, tenantId);
            progress = observed.sections.reduce(
                (acc, s) => ({
                    completed: acc.completed + s.completedItems,
                    total: acc.total + s.totalItems,
                }),
                { completed: 0, total: 0 },
            );
        } catch {
            progress = { completed: 0, total: 0 };
        }

        return {
            address: insp.propertyAddress,
            date: insp.date,
            inspectionStatus: insp.status,
            agreementSigned: !!signed,
            paymentStatus: insp.paymentStatus,
            reportPublished: isReportPublished(insp.reportStatus),
            progress,
            unreadMessages: unread.length,
        };
    }
}
