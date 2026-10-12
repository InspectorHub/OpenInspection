/**
 * Storage-facing helpers for the stepwise email test, kept apart from the pure
 * step runner so the runner can be exercised with plain fakes.
 */
import { and, eq } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/d1';
import { processedWebhookEvents, users } from '../db/schema';
import type { DeliveryOutcome, LastSend } from './email-test-steps';

type Db = ReturnType<typeof drizzle>;

/** Long enough to run the delivery and quota steps after the send; short enough to expire unattended. */
const LAST_SEND_TTL_S = 60 * 60;

const lastSendKey = (tenantId: string, userId: string) => `email-test-last-send:${tenantId}:${userId}`;

export async function readLastSend(kv: KVNamespace | undefined, tenantId: string, userId: string): Promise<LastSend | null> {
    if (!kv) return null;
    try {
        const raw = (await kv.get(lastSendKey(tenantId, userId), { type: 'json' })) as LastSend | null;
        return raw && typeof raw.messageId === 'string' ? raw : null;
    } catch {
        return null;
    }
}

export async function writeLastSend(kv: KVNamespace | undefined, tenantId: string, userId: string, send: LastSend): Promise<void> {
    if (!kv) return;
    try {
        await kv.put(lastSendKey(tenantId, userId), JSON.stringify(send), { expirationTtl: LAST_SEND_TTL_S });
    } catch { /* diagnostics only — a missing record just skips the later steps */ }
}

export async function clearLastSend(kv: KVNamespace | undefined, tenantId: string, userId: string): Promise<void> {
    if (!kv) return;
    try { await kv.delete(lastSendKey(tenantId, userId)); } catch { /* best effort */ }
}

/**
 * The signed-in user's own address. Looked up by the verified JWT subject within
 * the verified tenant; no request field participates.
 */
export async function readSessionEmail(db: Db, tenantId: string, userId: string): Promise<string | null> {
    const row = await db.select({ email: users.email }).from(users)
        .where(and(eq(users.id, userId), eq(users.tenantId, tenantId))).get();
    return row?.email?.trim() || null;
}

/**
 * Whether Resend has reported this message as delivered or bounced. The webhook
 * receiver dedup-records every verified event under
 * `<tenant>:resend:<normalized type>:<message id>:<raw event type>`, which is the
 * only trace of a delivered event (delivered events are not stored elsewhere).
 */
export async function lookupResendDelivery(db: Db, tenantId: string, messageId: string): Promise<DeliveryOutcome> {
    const has = async (eventId: string) => !!(await db.select({ id: processedWebhookEvents.eventId })
        .from(processedWebhookEvents).where(eq(processedWebhookEvents.eventId, eventId)).get());
    if (await has(`${tenantId}:resend:bounced:${messageId}:email.bounced`)) return 'bounced';
    if (await has(`${tenantId}:resend:delivered:${messageId}:email.delivered`)) return 'delivered';
    return 'none';
}
