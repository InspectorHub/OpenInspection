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

/** Map (workload, credential source) to the metric it accumulates under. The
 *  single mapping both the recorder and the guard read, so the counter that
 *  gets written and the counter that gets checked can never drift apart. */
export function aiUsageMetric(kind: AiUsageKind, source: AiCredentialSourceTag): UsageMetric {
    if (kind === 'translate') return source === 'managed' ? 'ai_translate' : 'ai_translate_byo';
    return source === 'managed' ? 'ai_assist' : 'ai_assist_byo';
}
