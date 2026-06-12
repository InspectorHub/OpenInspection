export type UsageMetric = 'sms' | 'email' | 'r2_bytes';
/** Calendar-month bucket key, UTC. Flows (sms/email) use this. */
export function currentPeriodKey(now: Date): string { return now.toISOString().slice(0, 7); }
/** Sentinel period for stock metrics (r2_bytes), overwritten rather than summed. */
export const STOCK_PERIOD = 'lifetime';
