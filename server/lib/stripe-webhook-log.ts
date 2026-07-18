/**
 * Per-tenant rolling diagnostics log for Stripe webhook deliveries
 * (GitHub-style "Recent Deliveries", right-sized). Metadata ONLY — never the
 * payload. KV last-write-wins may drop an entry under concurrent deliveries;
 * acceptable for a diagnostics surface. 30-day TTL self-cleans.
 *
 * Eviction defense: `signature_failed` entries are written BEFORE
 * verification, so an attacker POSTing garbage to a tenant's public slug URL
 * could otherwise evict every genuine row within CAP requests. Unverified
 * failures are sub-capped (SIG_FAILED_CAP) so verified entries always survive.
 */
type StripeWebhookResult = 'processed' | 'received' | 'signature_failed' | 'tenant_mismatch';

export interface StripeWebhookLogEntry {
    ts: string; // ISO 8601
    eventType: string;
    result: StripeWebhookResult;
}

const PREFIX = 'stripe-webhook-log:';
const CAP = 20;
const SIG_FAILED_CAP = 5;
const TTL_S = 60 * 60 * 24 * 30;

export function stripeWebhookLogKey(tenantId: string): string {
    return `${PREFIX}${tenantId}`;
}

export async function appendWebhookLogEntry(
    kv: KVNamespace | undefined,
    tenantId: string,
    entry: Omit<StripeWebhookLogEntry, 'ts'>,
): Promise<void> {
    if (!kv) return;
    try {
        const key = stripeWebhookLogKey(tenantId);
        const existing = ((await kv.get(key, { type: 'json' }).catch(() => null)) as StripeWebhookLogEntry[] | null) ?? [];
        const list = Array.isArray(existing) ? existing : [];
        // Newest first; unverified failures sub-capped so they can never push
        // verified rows out of the window (see eviction defense above).
        let sigFailedKept = 0;
        const next = [{ ...entry, ts: new Date().toISOString() }, ...list]
            .filter((e) => e.result !== 'signature_failed' || ++sigFailedKept <= SIG_FAILED_CAP)
            .slice(0, CAP);
        await kv.put(key, JSON.stringify(next), { expirationTtl: TTL_S });
    } catch { /* diagnostics only — never fail the webhook over this */ }
}

export async function readWebhookLog(
    kv: KVNamespace | undefined,
    tenantId: string,
): Promise<StripeWebhookLogEntry[]> {
    if (!kv) return [];
    try {
        const val = (await kv.get(stripeWebhookLogKey(tenantId), { type: 'json' })) as StripeWebhookLogEntry[] | null;
        return Array.isArray(val) ? val : [];
    } catch {
        return [];
    }
}
