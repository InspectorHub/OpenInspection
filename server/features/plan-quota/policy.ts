/**
 * Free-tier lifetime caps. Platform/managed sends only — bring-your-own (`*_byo`)
 * volume is uncapped and metered separately under the `sms_byo`/`email_byo`
 * metrics. Spec: free-tier usage quotas (2026-07).
 */
/** No `ai_*` entry, deliberately: the free tier has no MANAGED AI path to cap —
 *  it is bring-your-own-key only, which costs the deployment nothing and needs
 *  no meter. Capping a thing is more machinery than not offering it. An absent
 *  entry here looks like an oversight, so: it is not one. */
export const FREE_TIER_CAPS = { inspections: 5, sms: 50, email: 50 } as const;

/** The AI metrics a cap can be expressed against. Only the managed (platform-
 *  funded) side appears: `*_byo` volume is the tenant's own bill, so there is
 *  nothing for this deployment to limit. */
export type AiCappedMetric = 'ai_translate' | 'ai_assist';

/**
 * Per-tier AI allowances, keyed by tier then metric.
 *
 * Empty by construction and supplied at runtime, NOT hardcoded here: any number
 * chosen before real usage data exists would be invented, and a wrong number
 * silently blocks every tenant on that tier. An absent entry means "no cap
 * configured", which the guard reads as no enforcement — metering still runs,
 * so the number can be set the day one is justified rather than guessed today.
 */
export type AiTierCaps = Readonly<Record<string, Partial<Record<AiCappedMetric, number>>>>;
