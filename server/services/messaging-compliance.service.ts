import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { messagingCompliance } from '../lib/db/schema';
import { TwilioClient } from '../lib/messaging/twilio';

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
}
