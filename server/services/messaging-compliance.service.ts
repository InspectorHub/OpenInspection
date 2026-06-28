import { drizzle } from 'drizzle-orm/d1';
import { and, eq, inArray, notInArray } from 'drizzle-orm';
import { messagingCompliance } from '../lib/db/schema';
import { TwilioClient } from '../lib/messaging/twilio';
import { logger } from '../lib/logger';
import type { ComplianceEvent } from '../lib/sms/compliance-webhook';
import type { UserSyncOutbox } from '../lib/integration/user-sync';
import { D1ComplianceStateStore } from '../lib/messaging/compliance-state-store';
import type { ComplianceProvider, ComplianceProviderId } from '../lib/messaging/compliance-provider';
import { resolveComplianceProvider, type ComplianceResolverEnv } from '../lib/sms/resolve-compliance-provider';

type ReadClient = Pick<TwilioClient, 'tollfree' | 'brands'>;

/** Map Twilio's raw TFV status string to our compliance_status enum. */
const mapTfv = (s: string): 'approved' | 'rejected' | 'tfv_pending' =>
    s === 'TWILIO_APPROVED' ? 'approved' : s === 'TWILIO_REJECTED' ? 'rejected' : 'tfv_pending';

/**
 * MessagingComplianceService — read-only mirror of a tenant's own Twilio account.
 * Never creates or modifies entities on the tenant's Twilio account; only reads
 * toll-free verification + brand registration status and upserts our local snapshot.
 *
 * Used by:
 *   - GET /api/manager/sms/compliance (Task 4 admin route) — Settings page status card.
 *   - Future cron reconciler — periodic background sync for managed tenants.
 */
export class MessagingComplianceService {
    constructor(private db: D1Database) {}

    private d() { return drizzle(this.db); }

    /**
     * Returns the stored compliance snapshot for a tenant, or null if none exists yet.
     * Shape matches the admin route response (`data.complianceStatus`, etc.).
     */
    async getStatus(tenantId: string): Promise<{
        complianceStatus: string;
        rejectionReason: string | null;
        lastSyncAt: number | null;
    } | null> {
        const row = await this.d()
            .select()
            .from(messagingCompliance)
            .where(eq(messagingCompliance.tenantId, tenantId))
            .get();
        if (!row) return null;
        return {
            complianceStatus: row.complianceStatus,
            rejectionReason: row.rejectionReason ?? null,
            lastSyncAt: row.lastSyncAt?.getTime() ?? null,
        };
    }

    /**
     * Reads the tenant's own Twilio account (toll-free verifications + brand
     * registrations) and upserts the result into `messaging_compliance`.
     *
     * @param tenantId - Tenant to update (read from JWT context, never user input).
     * @param creds    - The tenant's own Twilio credentials (sid + token).
     * @param client   - Injectable Twilio adapter (defaults to a real TwilioClient;
     *                   pass a fake in tests to avoid network calls).
     */
    async syncOwnStatus(
        tenantId: string,
        creds: { sid: string; token: string },
        client: ReadClient = new TwilioClient(creds),
    ): Promise<void> {
        const tfvs = await client.tollfree.list().catch(() => []);
        const status = tfvs.length ? mapTfv(tfvs[0].status) : 'not_started';
        const now = new Date();
        await this.d()
            .insert(messagingCompliance)
            .values({
                tenantId,
                mode: 'own',
                complianceStatus: status,
                tfvStatus: tfvs[0]?.status ?? null,
                lastSyncAt: now,
                createdAt: now,
                updatedAt: now,
            })
            .onConflictDoUpdate({
                target: messagingCompliance.tenantId,
                set: {
                    complianceStatus: status,
                    tfvStatus: tfvs[0]?.status ?? null,
                    lastSyncAt: now,
                    updatedAt: now,
                },
            });
    }

    // -------------------------------------------------------------------------
    // Managed provisioning orchestrator (write path) — COORDINATOR
    //
    // The provisioning step graph + the row load/init/persist mechanics now live in
    // the injected ComplianceProvider (server/lib/messaging/providers/*) and the
    // D1ComplianceStateStore (server/lib/messaging/compliance-state-store.ts). This
    // service is a thin coordinator: it builds the store on its own D1 handle and
    // delegates the provider-specific orchestration.
    // -------------------------------------------------------------------------

    /**
     * Idempotent managed provisioning orchestrator — delegates to the provider.
     *
     * Builds the D1-backed state store on this service's database handle and hands
     * it to `provider.provision`, which runs the guarded, resumable resource-creation
     * chain and persists each SID through the store. Behaviour (step ordering,
     * resume-on-missing-SID, crash-leaves-prior-SIDs, statusCallback threading) is
     * owned by the provider and unchanged from the previous in-service implementation.
     *
     * @param tenantId     - Tenant to provision (from JWT context, never user input).
     * @param businessInfo - Legal name, address, rep name, optional area code/email.
     * @param channel      - 'sp10dlc' (10DLC sole-proprietor) or 'tollfree'.
     * @param provider     - Injectable ComplianceProvider (the managed admin route
     *                       builds it via resolveComplianceProvider; tests inject one).
     * @param statusCallbackUrl - Optional per-tenant compliance webhook URL, threaded
     *                       into the customer-profile create (only on NEW provisions).
     */
    async provision(
        tenantId: string,
        businessInfo: {
            legalName: string;
            address: string;
            repName: string;
            areaCode?: string | undefined;
            email?: string | undefined;
        },
        channel: 'sp10dlc' | 'tollfree',
        provider: ComplianceProvider,
        statusCallbackUrl?: string,
    ): Promise<{ complianceStatus: string }> {
        const store = new D1ComplianceStateStore(this.db);
        const snapshot = await provider.provision(
            { tenantId, channel, businessInfo, statusCallbackUrl },
            store,
        );
        return { complianceStatus: snapshot.complianceStatus };
    }

    // -------------------------------------------------------------------------
    // Compliance-status webhook receiver (Task 7)
    // -------------------------------------------------------------------------

    /**
     * Apply a compliance-status callback from Twilio and advance the tenant's
     * complianceStatus state machine.
     *
     * Status mapping (raw Twilio → our enum):
     *   TWILIO_APPROVED / APPROVED → 'approved'
     *   TWILIO_REJECTED / REJECTED / FAILED → 'rejected'
     *   anything else → the per-entity pending status
     *     brand:    'brand_pending'
     *     campaign: 'campaign_pending'
     *     tfv:      'tfv_pending'
     *
     * The rolled-up `complianceStatus` moves to 'approved' ONLY when the
     * terminal entity for the channel is approved:
     *   sp10dlc channel: terminal entity = campaign
     *   tollfree channel: terminal entity = tfv
     * A brand approval alone does NOT set complianceStatus='approved'.
     *
     * A rejection in any entity sets complianceStatus='rejected' + stores the
     * rejectionReason verbatim from the Twilio payload.
     *
     * @param tenantId - Tenant whose row to update (from the route path slug,
     *                   already resolved and verified before this is called).
     * @param event    - Parsed compliance event from parseComplianceEvent.
     */
    async applyComplianceCallback(
        tenantId: string,
        event: ComplianceEvent,
    ): Promise<{ changed: boolean; complianceStatus: string; rejectionReason: string | null }> {
        const store = new D1ComplianceStateStore(this.db);
        const row = await store.load(tenantId);
        if (!row) {
            logger.warn('[compliance-svc] applyComplianceCallback: no row for tenant — ignoring', { tenantId });
            return { changed: false, complianceStatus: 'not_started', rejectionReason: null };
        }

        const isApproved = event.rawStatus === 'TWILIO_APPROVED' || event.rawStatus === 'APPROVED';
        const isRejected = event.rawStatus === 'TWILIO_REJECTED' || event.rawStatus === 'REJECTED' || event.rawStatus === 'FAILED';

        const updates: Partial<typeof messagingCompliance.$inferInsert> = {};

        if (event.entity === 'brand') {
            updates.brandStatus = event.rawStatus;
            if (isApproved) {
                // Brand approval alone does not set overall approved (campaign is
                // terminal for sp10dlc) — it only advances to brand_pending. Twilio
                // re-delivers callbacks and does not guarantee brand-before-campaign
                // ordering, so NEVER move a more-advanced status backward: a late
                // brand-approved must not regress campaign_pending/approved (which
                // would silently disable an approved tenant's SMS at the send gate).
                if (row.complianceStatus !== 'approved' && row.complianceStatus !== 'campaign_pending') {
                    updates.complianceStatus = 'brand_pending';
                }
            } else if (isRejected) {
                updates.complianceStatus = 'rejected';
                updates.rejectionReason = event.rejectionReason ?? event.rawStatus;
            } else {
                updates.brandStatus = event.rawStatus;
            }
        } else if (event.entity === 'campaign') {
            updates.campaignStatus = event.rawStatus;
            if (isApproved) {
                // Campaign is the terminal entity for sp10dlc.
                updates.complianceStatus = 'approved';
                updates.rejectionReason = null;
            } else if (isRejected) {
                updates.complianceStatus = 'rejected';
                updates.rejectionReason = event.rejectionReason ?? event.rawStatus;
            } else if (row.complianceStatus !== 'approved') {
                // No-regress: a non-terminal campaign callback must never downgrade
                // an already-approved row to pending (callbacks are re-delivered and
                // unordered; a downgrade would silently disable an approved tenant's
                // SMS at the send gate until the next reconciling sweep).
                updates.complianceStatus = 'campaign_pending';
            }
        } else {
            // entity === 'tfv'
            updates.tfvStatus = event.rawStatus;
            if (isApproved) {
                // TFV is the terminal entity for tollfree.
                updates.complianceStatus = 'approved';
                updates.rejectionReason = null;
            } else if (isRejected) {
                updates.complianceStatus = 'rejected';
                updates.rejectionReason = event.rejectionReason ?? event.rawStatus;
            } else if (row.complianceStatus !== 'approved') {
                // No-regress: a non-terminal TFV callback must never downgrade an
                // already-approved row to pending (see the campaign branch above).
                updates.complianceStatus = 'tfv_pending';
            }
        }

        const newStatus = updates.complianceStatus ?? row.complianceStatus;
        const newRejectionReason = 'rejectionReason' in updates
            ? (updates.rejectionReason ?? null)
            : (row.rejectionReason ?? null);
        // `changed` is true when the rolled-up complianceStatus differs from the
        // prior persisted value. Sub-status fields (brandStatus etc.) changing
        // without a complianceStatus change do NOT set changed=true.
        const changed = newStatus !== row.complianceStatus;

        await store.persist(tenantId, updates);
        logger.info('[compliance-svc] applied compliance callback', {
            tenantId,
            entity: event.entity,
            rawStatus: event.rawStatus,
            newStatus,
            changed,
        });
        return { changed, complianceStatus: newStatus, rejectionReason: newRejectionReason };
    }

    // -------------------------------------------------------------------------
    // Cron poll fallback (Task 7) — re-reads status from Twilio for managed
    // tenants whose complianceStatus is not yet terminal.
    // -------------------------------------------------------------------------

    /**
     * Sync a managed tenant's compliance status from Twilio (cron fallback).
     *
     * Called by the scheduled sweeper for each non-terminal managed tenant row.
     * Uses READ-ONLY Twilio API surfaces:
     *   - TFV path (tollfree channel): client.tollfree.list() — available.
     *   - Brand path (sp10dlc channel): client.brands.list() — available.
     *
     * NOTE: Campaign status is NOT available as a read method via the Twilio
     * REST API — the campaign status is only delivered via webhook (see Twilio
     * docs for /v1/Services/:sid/Compliance/Usa2p). The webhook is therefore the
     * PRIMARY path for campaign approval; the cron poll covers brands + TFV only.
     * Campaign rows in non-terminal state will remain campaign_pending until
     * Twilio posts the callback.
     *
     * @param tenantId - Tenant to sync.
     * @param provider - Injectable ComplianceProvider (the sweep builds it from the
     *                   managed ISV creds; tests inject a fake). Owns the read +
     *                   normalized-state advance; this coordinator owns change-detection.
     */
    async syncManagedStatus(
        tenantId: string,
        provider: ComplianceProvider,
    ): Promise<{ changed: boolean; complianceStatus: string; rejectionReason: string | null }> {
        const store = new D1ComplianceStateStore(this.db);
        // Snapshot the prior rolled-up status BEFORE the provider advances state, so
        // change-detection compares against the pre-sync value (the provider persists
        // any transition through the store, but its snapshot carries no `changed`).
        const priorRow = await store.load(tenantId);
        if (!priorRow) return { changed: false, complianceStatus: 'not_started', rejectionReason: null };

        const snapshot = await provider.syncStatus({ tenantId }, store);
        // Coordinator owns change-detection (same contract as before): `changed` is true
        // only when the rolled-up complianceStatus differs from the prior persisted value.
        const changed = snapshot.complianceStatus !== priorRow.complianceStatus;
        return { changed, complianceStatus: snapshot.complianceStatus, rejectionReason: snapshot.rejectionReason };
    }

    /**
     * Sweep all managed, non-terminal rows and re-read status from the carrier.
     * Called from the scheduled cron. Fail-soft: a single tenant's error
     * does not abort the sweep for other tenants.
     *
     * Per-row provider: each managed row carries its own `provider` column
     * ('twilio' | 'telnyx'). The matching ComplianceProvider is built ONCE per
     * distinct provider id (memoized in a Map) from the combined ISV env, so a
     * mixed Twilio + Telnyx fleet is swept correctly in one pass. A row whose
     * provider has no configured ISV creds (resolver throws) is skipped fail-soft.
     *
     * NOTE: Campaign status polling is NOT available via the Twilio REST API
     * (the webhook is the primary campaign-approval path there); Telnyx DOES
     * expose campaign status. Each provider's syncStatus handles its own surface.
     *
     * @param env             - Combined ISV credential env (TWILIO_* triple + TELNYX_API_KEY).
     *                          The provider for a given row is resolved by row.provider.
     * @param outbox          - Optional sync outbox (SaaS) for status-change propagation.
     * @param providerFactory - Injectable provider builder (tests pass a fake to avoid
     *                          network). Defaults to resolveComplianceProvider(env, id).
     */
    async sweepManagedStatuses(
        env: ComplianceResolverEnv,
        outbox?: UserSyncOutbox,
        providerFactory: (id: ComplianceProviderId) => ComplianceProvider =
            (id) => resolveComplianceProvider(env, id),
    ): Promise<void> {
        const db = this.d();
        const terminalStatuses = ['approved', 'rejected'] as const;

        // Fetch all managed rows that are not yet in a terminal status.
        // managed_shared and managed_dedicated are the only modes that use
        // the managed ISV account; 'own' tenants poll their own creds
        // separately (syncOwnStatus). The mode filter is load-bearing: without it
        // an 'own' row (tfvSid NULL) would be polled against the ISV master account
        // and have its compliance state overwritten with an unrelated account's data.
        const managedRows = await db
            .select({ tenantId: messagingCompliance.tenantId, provider: messagingCompliance.provider })
            .from(messagingCompliance)
            .where(and(
                inArray(messagingCompliance.mode, ['managed_shared', 'managed_dedicated']),
                notInArray(messagingCompliance.complianceStatus, [...terminalStatuses]),
            ))
            .all();

        // Memoize one provider per distinct row.provider so the ISV client is built
        // at most once per carrier across the whole sweep.
        const providerCache = new Map<ComplianceProviderId, ComplianceProvider>();
        const getProvider = (id: ComplianceProviderId): ComplianceProvider | null => {
            const cached = providerCache.get(id);
            if (cached) return cached;
            try {
                const built = providerFactory(id);
                providerCache.set(id, built);
                return built;
            } catch {
                // Provider not configured (creds absent) — skip its rows fail-soft.
                return null;
            }
        };

        for (const { tenantId, provider: rowProvider } of managedRows) {
            try {
                // Rows pre-dating multi-provider support have provider NULL → default twilio.
                const provider = getProvider(rowProvider ?? 'twilio');
                if (!provider) {
                    logger.warn('[compliance-svc] sweepManagedStatuses: provider not configured — skipping',
                        { tenantId, provider: rowProvider ?? 'twilio' });
                    continue;
                }
                const result = await this.syncManagedStatus(tenantId, provider);
                if (result.changed && outbox) {
                    // Fail-soft outbox emit: a queue failure must not abort the sweep.
                    outbox.append({
                        type: 'io.inspectorhub.tenant.compliance_status_updated',
                        payload: {
                            tenantId,
                            complianceStatus: result.complianceStatus,
                            rejectionReason: result.rejectionReason,
                            updatedAt: Math.floor(Date.now() / 1000),
                        },
                    }).catch((err) => {
                        logger.error('[compliance-svc] sweepManagedStatuses: outbox emit failed', { tenantId },
                            err instanceof Error ? err : new Error(String(err)));
                    });
                }
            } catch (err) {
                // Fail-soft: log the error but continue sweeping remaining tenants.
                logger.error('[compliance-svc] sweepManagedStatuses: tenant sync failed', { tenantId },
                    err instanceof Error ? err : new Error(String(err)));
            }
        }

        if (managedRows.length > 0) {
            logger.info('[compliance-svc] sweepManagedStatuses: swept tenants', { count: managedRows.length });
        }
    }
}
