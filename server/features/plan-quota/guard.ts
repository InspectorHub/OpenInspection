import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { tenants } from '../../lib/db/schema';
import { MeteringService } from '../../services/metering.service';
import { STOCK_PERIOD } from '../../lib/usage/period';
import { Errors } from '../../lib/errors';
import { FREE_TIER_CAPS, type AiCappedMetric, type AiTierCaps, type TenantPlan } from './policy';

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
 *
 * IMPORTANT — `usage_counters.value` for the `inspections` metric is a CACHE,
 * not the gate. The cap counts the inspection rows a tenant has; the counter is
 * written alongside it and heals itself on the next create. A value that looks
 * wrong (higher than the row count, e.g. after a delete) is therefore not a
 * defect and must NOT be "corrected" by hand — that is what the 2026-08-05
 * production hand-fix did, and it is exactly what this design makes
 * unnecessary. Deleting the row is worse than leaving it: see the INSERT-branch
 * gating below. `sms`/`email` are the opposite — consumed events with nothing
 * to count, so their counters ARE the source of truth.
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
  return (await readTenantPlan(db, tenantId)).tier;
}

/**
 * The tenant's tier AND status in one read.
 *
 * Both columns, because "is this tenant paying" needs both (`isPaidPlan`) and
 * two callers reading two columns off the same row in two queries is how the
 * two answers end up describing different moments. `readTenantTier` above is
 * the narrow view for callers that only ever ask about a cap; it delegates here
 * so there is still exactly one query shape.
 *
 * Defaults on a missing row are the least-privileged ones: the free tier, and a
 * status that is not `active`. An absent tenant must not read as a paying one.
 */
export async function readTenantPlan(db: D1Database, tenantId: string): Promise<TenantPlan> {
  const row = await drizzle(db).select({ tier: tenants.tier, status: tenants.status }).from(tenants)
    .where(eq(tenants.id, tenantId)).get();
  return { tier: row?.tier ?? 'free', status: row?.status ?? 'pending' };
}

export class PlanQuotaGuard {
  constructor(
    private db: D1Database,
    private opts: {
      enforced: boolean;
      billingPortalUrl: string | null;
      /** Per-tier AI allowances, when the deployment has been given any.
       *  Absent/empty means no AI enforcement — see `checkAiQuota`.
       *
       *  Either the caps themselves, or a loader that fetches them for one
       *  tenant. Production passes the loader (`tenantAiCapsLoader`): two of the
       *  seven construction sites are hostile to an eager read — one runs on
       *  every authenticated request, and one is reused across every tenant in a
       *  cron tick, where a single resolved value would bind the first tenant's
       *  caps to everyone else's check. Tests pass the object, which is what
       *  keeps a configured-cap control cheap to write. */
      aiCaps?: AiTierCaps | ((tenantId: string) => Promise<AiTierCaps | undefined>);
    },
  ) {}

  /** Atomic consume for inspection creation. Free+enforced: allow-if-the-rows-a-
   *  tenant-has-plus-`count`-fit-under-the-cap (throws QuotaExhausted otherwise).
   *  Other tiers / standalone: plain increment (lifetime analytics). The cap
   *  counts the inspections a tenant HAS, so deleting one returns the allowance.
   *
   *  `count` is the number of inspections the caller is about to create in one
   *  go. It must be passed for a batch rather than looping: because the gate
   *  counts rows and the caller inserts them only after this returns, N looped
   *  calls all read the same count and all pass — a 3-sub request would take a
   *  tenant from 3 inspections to 6. One call with `count: 3` is the same single
   *  statement and admits the batch only if the whole batch fits. */
  async consumeInspection(tenantId: string, count = 1): Promise<void> {
    const tier = await readTenantTier(this.db, tenantId);

    if (!this.opts.enforced || tier !== 'free') {
      await new MeteringService(this.db).record(tenantId, 'inspections', STOCK_PERIOD, count);
      return;
    }

    const cap = FREE_TIER_CAPS.inspections;
    // THE GATE COUNTS ROWS. `usage_counters.value` is a self-healing display
    // cache for this metric, never the thing enforced — a stale value can no
    // longer refuse a tenant who is genuinely under the cap, and a delete
    // returns the allowance without anything having to write the counter back.
    // (Do not "fix" a stale value by hand; the next create heals it. See #105.)
    //
    // Still a single statement, and still atomic: D1/SQLite serialize writes to
    // a given row, so `meta.changes === 0` remains the authoritative "at cap"
    // answer with no read-then-write window inside the guard. The INSERT branch
    // is gated too — hence `INSERT ... SELECT ... WHERE` rather than VALUES,
    // because a conflict-free INSERT never reaches DO UPDATE and would wave
    // through a tenant who has rows but no counter row yet.
    //
    // What counting rows DOES give up, unavoidably: the caller inserts the
    // inspection row AFTER this returns, so two creates that overlap before
    // either row lands both see the same count and both pass. The cap is
    // therefore a steady-state invariant, not a serialized claim — an overshoot
    // is bounded by in-flight concurrency and self-corrects, because the next
    // create counts the rows that actually exist and refuses. That trade is
    // deliberate: the alternative (a counter that can only climb) is what cost
    // real tenants their allowance permanently. The one case that would NOT
    // have been a rare race — a caller creating N rows in a loop — is why
    // `count` exists rather than being left to the caller to iterate.
    const res = await this.db.prepare(
      `INSERT INTO usage_counters (tenant_id, metric, period_key, value, updated_at)
       SELECT ?1, 'inspections', 'lifetime', cnt.n + ?4, ?2
       FROM (SELECT COUNT(*) AS n FROM inspections WHERE tenant_id = ?1) AS cnt
       WHERE cnt.n + ?4 <= ?3
       ON CONFLICT(tenant_id, metric, period_key)
       DO UPDATE SET value = (SELECT COUNT(*) FROM inspections WHERE tenant_id = excluded.tenant_id) + ?4,
                     updated_at = excluded.updated_at
       WHERE (SELECT COUNT(*) FROM inspections WHERE tenant_id = excluded.tenant_id) + ?4 <= ?3`,
    ).bind(tenantId, Date.now(), cap, count).run();

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
    const caps = typeof this.opts.aiCaps === 'function'
      ? await this.opts.aiCaps(tenantId)
      : this.opts.aiCaps;
    const cap = caps?.[tier]?.[metric];
    if (cap === undefined) return;
    const used = await new MeteringService(this.db).lifetimeTotal(tenantId, metric);
    if (used >= cap) throw Errors.QuotaExhausted({ metric, used, cap, billingPortalUrl: this.opts.billingPortalUrl });
  }
}
