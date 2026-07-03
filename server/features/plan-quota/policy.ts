/**
 * Free-tier lifetime caps. Platform/managed sends only — bring-your-own (`*_byo`)
 * volume is uncapped and metered separately under the `sms_byo`/`email_byo`
 * metrics. Spec: free-tier usage quotas (2026-07).
 */
export const FREE_TIER_CAPS = { inspections: 5, sms: 50, email: 50 } as const;

export type QuotaMetric = keyof typeof FREE_TIER_CAPS;
