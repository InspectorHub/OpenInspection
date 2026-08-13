export type UsageMetric =
    | 'sms' | 'email' | 'r2_bytes' | 'inspections'
    | 'sms_byo' | 'email_byo'
    | 'ai_translate' | 'ai_translate_byo'
    | 'ai_assist'    | 'ai_assist_byo';
/** Calendar-month bucket key, UTC. Flows (sms/email) use this. */
export function currentPeriodKey(now: Date): string { return now.toISOString().slice(0, 7); }
/** Sentinel period for stock metrics (r2_bytes), overwritten rather than summed. */
export const STOCK_PERIOD = 'lifetime';

/**
 * The two AI workloads, metered separately because their cost profiles differ
 * by an order of magnitude: roughly one translation per report against tens of
 * assist calls per inspection. One shared metric would force a choice between
 * an unusable assistant and an effectively uncapped translation budget.
 */
export type AiUsageKind = 'translate' | 'assist';

/** Where the credentials for a call came from — the same `*_byo` split
 *  `plan-quota/policy.ts` already documents for sends. Platform-funded volume
 *  is what a cap can ever be about; bring-your-own volume is the tenant's own
 *  bill and is counted for analytics only. */
export type AiCredentialSourceTag = 'managed' | 'byo';

/** The PLATFORM-FUNDED half of the AI metrics — the only ones an allowance can
 *  ever be about, and therefore the only ones the quota guard names.
 *  `plan-quota/policy.ts` aliases its `AiCappedMetric` to this rather than
 *  restating the two members. */
export type ManagedAiMetric = Extract<UsageMetric, 'ai_translate' | 'ai_assist'>;

/** The one mapping, as data. Total over `AiUsageKind` by construction, so a
 *  third workload cannot be added without giving it a metric on both sides. */
const MANAGED_METRIC: Record<AiUsageKind, ManagedAiMetric> = {
    translate: 'ai_translate',
    assist: 'ai_assist',
};
const BYO_METRIC: Record<AiUsageKind, UsageMetric> = {
    translate: 'ai_translate_byo',
    assist: 'ai_assist_byo',
};

/** The metric a workload accumulates under when the PLATFORM funded it. The
 *  pre-flight quota check reads this and the recorder reads `aiUsageMetric`
 *  below off the same table, so the counter that gets checked and the counter
 *  that gets written cannot name two different rows. */
export function managedAiMetric(kind: AiUsageKind): ManagedAiMetric {
    return MANAGED_METRIC[kind];
}

/** Map (workload, credential source) to the metric it accumulates under. The
 *  single mapping both the recorder and the guard read, so the counter that
 *  gets written and the counter that gets checked can never drift apart. */
export function aiUsageMetric(kind: AiUsageKind, source: AiCredentialSourceTag): UsageMetric {
    return source === 'managed' ? MANAGED_METRIC[kind] : BYO_METRIC[kind];
}
