export type UsageMetric = 'sms' | 'email' | 'r2_bytes' | 'inspections' | 'sms_byo' | 'email_byo';
/** Calendar-month bucket key, UTC. Flows (sms/email) use this. */
export function currentPeriodKey(now: Date): string { return now.toISOString().slice(0, 7); }
/** Sentinel period for stock metrics (r2_bytes), overwritten rather than summed. */
export const STOCK_PERIOD = 'lifetime';
