import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { tenants } from '../../lib/db/schema';
import { MeteringService } from '../../services/metering.service';
import { STOCK_PERIOD } from '../../lib/usage/period';
import { Errors } from '../../lib/errors';
import { FREE_TIER_CAPS, type AiCappedMetric, type AiTierCaps } from './policy';

/**
 * Free-tier usage-quota guard. Two calling shapes:
 *  - `consumeInspection` — atomic increment-if-below-cap, called at inspection
 *    creation. Free+enforced tenants are blocked at the cap; every other tier
 *    (and standalone deploys, where `enforced` is false) get an uncapped
 *    lifetime counter for analytics only.
 *  - `checkMessagingQuota` — a pre-flight read-only check for sms/email sends.
 *    The actual meter increment stays at the existing send-site call (see
 *    MeteringService.record in the sms/email pipelines) so a provider failure
 *    never consumes quota it didn't actually spend.
 */
/**
 * One-line tenant-tier lookup, defaulting to 'free' when the row is missing
 * or the query fails. Shared by `consumeInspection` (below) and every
 * `assembleTenantEmailService`/`buildTenantEmailService` caller that has no
 * session-context `tenantTier` to read (JWT-authenticated saas API requests
 * never populate it — only the public/fixed-tenant tenant-routing resolvers
 * do — and non-request contexts like Workflows/cron have no context at all).
 */
export async function readTenantTier(db: D1Database, tenantId: string): Promise<string> {
  const row = await drizzle(db).select({ tier: tenants.tier }).from(tenants)
    .where(eq(tenants.id, tenantId)).get();
  return row?.tier ?? 'free';
}

export class PlanQuotaGuard {
  constructor(
    private db: D1Database,
    private opts: {
      enforced: boolean;
      billingPortalUrl: string | null;
      /** Per-tier AI allowances, when the deployment has been given any.
       *  Absent/empty means no AI enforcement — see `checkAiQuota`. */
      aiCaps?: AiTierCaps;
    },
  ) {}

  /** Atomic consume for inspection creation. Free+enforced: increment-if-below-cap
   *  (throws QuotaExhausted at the cap). Other tiers / standalone: plain increment
   *  (lifetime analytics). Counter is monotonic — deletes never refund. */
  async consumeInspection(tenantId: string): Promise<void> {
    const tier = await readTenantTier(this.db, tenantId);

    if (!this.opts.enforced || tier !== 'free') {
      await new MeteringService(this.db).record(tenantId, 'inspections', STOCK_PERIOD);
      return;
    }

    const cap = FREE_TIER_CAPS.inspections;
    // Single-statement conditional increment: the guarded UPDATE only fires
    // while value < cap, so D1's `meta.changes === 0` is the authoritative
    // "already at cap" signal even under concurrent callers — SQLite/D1
    // serialize writes to a given row, so there is no read-then-write window
    // for two callers to both observe "below cap" and both increment past it.
    const res = await this.db.prepare(
      `INSERT INTO usage_counters (tenant_id, metric, period_key, value, updated_at)
       VALUES (?1, 'inspections', 'lifetime', 1, ?2)
       ON CONFLICT(tenant_id, metric, period_key)
       DO UPDATE SET value = value + 1, updated_at = ?2
       WHERE usage_counters.value < ?3`,
    ).bind(tenantId, Date.now(), cap).run();

    if (res.meta.changes === 0) {
      throw Errors.QuotaExhausted({ metric: 'inspections', used: cap, cap, billingPortalUrl: this.opts.billingPortalUrl });
    }
  }

  /** Pre-flight check for a platform-metered messaging send. Read-only — the
   *  actual counter increment happens at the existing send-site meter call,
   *  so a failed provider call never consumes quota. No-op for non-free
   *  tiers and for standalone (enforced=false) deploys. */
  async checkMessagingQuota(tenantId: string, tier: string, metric: 'sms' | 'email'): Promise<void> {
    if (!this.opts.enforced || tier !== 'free') return;
    const used = await new MeteringService(this.db).lifetimeTotal(tenantId, metric);
    const cap = FREE_TIER_CAPS[metric];
    if (used >= cap) throw Errors.QuotaExhausted({ metric, used, cap, billingPortalUrl: this.opts.billingPortalUrl });
  }

  /** Pre-flight check for a MANAGED (platform-funded) AI call. Same shape as
   *  `checkMessagingQuota` and for the same reason: read-only, so the counter
   *  increment stays at the single AI call-site meter and a failed model call
   *  never consumes an allowance it did not spend. AI calls fail more often
   *  than sends, which makes that ordering matter more here, not less.
   *
   *  No-op when enforcement is off (standalone) and no-op when no cap has been
   *  configured for the tier — which is every tier today. Metering ships before
   *  enforcement on purpose: this path exists and is tested, and the number
   *  arrives later as configuration rather than as an invented literal.
   *
   *  `metric` is always a managed metric: `*_byo` volume is the tenant's own
   *  bill and never counts toward anything this guard enforces. */
  async checkAiQuota(tenantId: string, tier: string, metric: AiCappedMetric): Promise<void> {
    if (!this.opts.enforced) return;
    const cap = this.opts.aiCaps?.[tier]?.[metric];
    if (cap === undefined) return;
    const used = await new MeteringService(this.db).lifetimeTotal(tenantId, metric);
    if (used >= cap) throw Errors.QuotaExhausted({ metric, used, cap, billingPortalUrl: this.opts.billingPortalUrl });
  }
}
