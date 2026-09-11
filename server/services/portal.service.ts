/**
 * Unified client portal — read-side aggregation service.
 *
 * Two responsibilities, both pure reads over EXISTING tables (no portal table):
 *   1. `listRecipientInspections` — every inspection a recipient email can see
 *      via a live `inspectionAccessTokens` grant whose role-profile KIND
 *      grants selfRetrieveReport (client / co_client by default — see
 *      server/lib/people/capabilities.ts; agent grants are out of scope for
 *      the client hub).
 *   2. `hubOverview` — a 6-dimension status snapshot for one inspection used by
 *      the portal landing card (status / agreement / payment / report / progress
 *      / unread messages).
 *
 * Multi-tenant: EVERY query filters by tenantId explicitly (see CLAUDE.md).
 */
import { drizzle } from 'drizzle-orm/d1';
import { and, eq, inArray, isNull, or, gt } from 'drizzle-orm';
import { inspectionAccessTokens, inspections, agreementRequests, inspectionMessages, contactRoleProfiles, invoices, tenantConfigs } from '../lib/db/schema';
import { isReportPublished } from '../lib/status/report-status';
import { PeopleService } from './people.service';

interface ObserveProgressLike {
    getSectionProgress: (
        inspectionId: string,
        tenantId: string,
    ) => Promise<{
        address: string;
        date: string | null;
        inspectorName: string;
        status: string;
        sections: Array<{ name: string; totalItems: number; completedItems: number }>;
    }>;
}

/** Full per-section progress, as returned by InspectionService.getSectionProgress. */
export interface ObserveProgress {
    address: string;
    date: string | null;
    inspectorName: string;
    status: string;
    sections: Array<{ name: string; totalItems: number; completedItems: number }>;
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
    /**
     * WHETHER A GATE EXISTS, not whether it is satisfied.
     *
     * `agreementSigned` / `paymentStatus` answer "is it done". On their own they
     * cannot tell "owed and outstanding" from "never owed", and both gate
     * columns default to false — so the Hub read an unsigned-and-unrequired
     * agreement as a lock and told the client to go sign a document that did
     * not exist. These three are what the server's own gate reads
     * (InspectionPublishService.getReportGate): either flag OFF means that half
     * of the gate does not apply, and `reportUnlocked` releases both.
     */
    agreementRequired: boolean;
    paymentRequired: boolean;
    reportUnlocked: boolean;
    /** A live (non-voided) invoice exists. `paymentStatus` is 'unpaid' on an
     *  inspection nobody has invoiced, which is not a debt. */
    hasInvoice: boolean;
    /** The repair-request builder is on for this company — the SAME column
     *  `runBuilderGate` enforces, so the nav can stop offering a tab whose every
     *  endpoint answers 403. */
    repairRequestEnabled: boolean;
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
     * non-expired) token whose role KEY currently grants selfRetrieveReport.
     * Deduplicated by inspection id.
     */
    async listRecipientInspections(tenantId: string, email: string): Promise<RecipientInspection[]> {
        const db = this.d();
        const now = new Date();

        // Capability-driven, not a hard-coded ['client', 'co_client'] list —
        // derives the eligible role keys from each active role profile's KIND
        // (server/lib/people/capabilities.ts). A tenant with no matching
        // active profile yields an empty set; short-circuit rather than let
        // an empty inArray reach the query.
        const selfRetrieveKeys = await new PeopleService({ DB: this.db }).roleKeysWithCapability(tenantId, 'selfRetrieveReport');
        if (selfRetrieveKeys.length === 0) return [];

        const grants = await db
            .select({ inspectionId: inspectionAccessTokens.inspectionId })
            .from(inspectionAccessTokens)
            .where(
                and(
                    eq(inspectionAccessTokens.tenantId, tenantId),
                    eq(inspectionAccessTokens.recipientEmail, email),
                    inArray(inspectionAccessTokens.role, selfRetrieveKeys),
                    isNull(inspectionAccessTokens.revokedAt),
                    // A grant is live only when not yet expired (NULL = never expires).
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
     * True when this email holds a live (non-revoked, non-expired) access token
     * whose role profile is CLIENT-kind (client/co_client) in this tenant.
     *
     * Deliberately NARROWER than listRecipientInspections: that method is
     * capability-driven (selfRetrieveReport) and so ALSO matches AGENT-kind
     * grants (Spec 3 opened selfRetrieveReport for agents). The find-my-report
     * redeem branch must route only GENUINE clients to a client session and
     * still send agents to the agent dashboard — so it keys on kind='client'
     * specifically, not the shared self-retrieve capability (#258 review #9).
     */
    async hasLiveClientGrant(tenantId: string, email: string): Promise<boolean> {
        const db = this.d();
        const now = new Date();
        const clientKeys = (await db.select({ key: contactRoleProfiles.key }).from(contactRoleProfiles)
            .where(and(
                eq(contactRoleProfiles.tenantId, tenantId),
                eq(contactRoleProfiles.kind, 'client'),
                eq(contactRoleProfiles.active, true),
            ))).map((r) => r.key);
        if (clientKeys.length === 0) return false;
        const row = await db.select({ id: inspectionAccessTokens.id }).from(inspectionAccessTokens)
            .where(and(
                eq(inspectionAccessTokens.tenantId, tenantId),
                eq(inspectionAccessTokens.recipientEmail, email),
                inArray(inspectionAccessTokens.role, clientKeys),
                isNull(inspectionAccessTokens.revokedAt),
                or(isNull(inspectionAccessTokens.expiresAt), gt(inspectionAccessTokens.expiresAt, now)),
            )).get();
        return row != null;
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

        // IS THERE ANYTHING TO PAY. Voided invoices are excluded everywhere else
        // money is counted (see contact-detail.ts), and they are excluded here for
        // the same reason: a withdrawn invoice is not a balance.
        const liveInvoice = await db
            .select({ id: invoices.id })
            .from(invoices)
            .where(and(
                eq(invoices.tenantId, tenantId),
                eq(invoices.inspectionId, inspectionId),
                isNull(invoices.voidedAt),
            ))
            .get();

        // The repair-builder feature switch. Read here rather than in the nav so
        // the UI never has to guess: capabilities are decided where they are
        // ENFORCED (CLAUDE.md, Cross-Portal Reuse) and this is the same column
        // `server/lib/repair-gates.ts` refuses on.
        const cfg = await db
            .select({ enableCustomerRepairExport: tenantConfigs.enableCustomerRepairExport })
            .from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, tenantId))
            .get();

        const unread = await db
            .select({ id: inspectionMessages.id })
            .from(inspectionMessages)
            .where(
                and(
                    eq(inspectionMessages.tenantId, tenantId),
                    eq(inspectionMessages.inspectionId, inspectionId),
                    isNull(inspectionMessages.readAt),
                    eq(inspectionMessages.fromRole, 'inspector'),
                ),
            );

        let progress = { completed: 0, total: 0 };
        try {
            const observed = await this.inspectionSvc.getSectionProgress(inspectionId, tenantId);
            progress = observed.sections.reduce(
                (acc, s) => ({
                    completed: acc.completed + s.completedItems,
                    total: acc.total + s.totalItems,
                }),
                { completed: 0, total: 0 },
            );
        } catch {
            // Leave the zeroed progress: it is a display value, not a gate.
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
            agreementRequired: insp.agreementRequired === true,
            paymentRequired: insp.paymentRequired === true,
            reportUnlocked: insp.unlockedAt != null,
            hasInvoice: liveInvoice != null,
            repairRequestEnabled: Boolean(cfg?.enableCustomerRepairExport),
        };
    }

    /**
     * Full per-section observe progress for one inspection, computed server-side
     * via InspectionService.getSectionProgress (tenant + inspection scoped — no
     * token needed). Backs the portal-session-authed observe endpoint so the Hub
     * Progress section reads it via the portal session rather than the separate
     * portal session. Returns null on failure (mirrors hubOverview's
     * progress fallback), which the caller maps to a 404 / error state.
     */
    async observeProgress(tenantId: string, inspectionId: string): Promise<ObserveProgress | null> {
        try {
            return await this.inspectionSvc.getSectionProgress(inspectionId, tenantId);
        } catch {
            return null;
        }
    }
}
