/**
 * WH-2 — SMS delivery-status receiver + shared inbound-signature verify.
 *
 * Extracted from server/api/sms.ts to keep that router file under the file-size
 * cap. Holds:
 *   - verifyInboundSignature: the provider-agnostic ctx-build + per-provider
 *     signature verify shared by the inbound consent webhook AND the
 *     delivery-status receiver (Twilio HMAC stays byte-identical to inbound).
 *   - parseTwilioStatus / parseTelnyxStatus: payload → normalized status.
 *   - upsertDeliveryStatus: last-writer-wins upsert into sms_delivery_status.
 *   - recordSentStatus: send-path id-stamping seed (a 'sent' row on send).
 *   - registerSmsStatusRoute: mounts POST /sms/status/:tenant on the public
 *     router (verify → dedup → parse → upsert).
 */
import { drizzle } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import type { Hono, Context } from 'hono';
import { tenants, tenantConfigs, smsDeliveryStatus, processedWebhookEvents } from '../db/schema';
import { validateTwilioSignature } from './send-sms';
import { verifyTelnyxSignature } from '../messaging/telnyx';
import { loadTenantSecrets } from '../secrets-cache';
import { getBaseUrl } from '../url';
import type { HonoConfig } from '../../types/hono';

/**
 * Build the provider-agnostic signature context and verify the inbound webhook
 * signature, reading the request body ONCE (single-consume stream; Telnyx signs
 * the exact raw bytes). Shared by the inbound consent webhook and the
 * delivery-status receiver so the ctx-build + per-provider verify is identical.
 *
 * Twilio verification is byte-identical to the inbound path: HMAC over
 * `getBaseUrl(c) + path` + the params parsed from the raw form body, against the
 * `x-twilio-signature` header. Telnyx verification reuses verifyTelnyxSignature
 * (Ed25519 over `${timestamp}|${rawBody}`, ±300s anti-replay).
 *
 * Returns the verify outcome plus the consumed `rawBody` and the parsed Twilio
 * params (empty for Telnyx). Fail-closed: missing secret, body-read failure, or
 * a bad signature all yield `ok:false` (the caller maps to 403/400). Never throws.
 */
export async function verifyInboundSignature(
    c: Context<HonoConfig>,
    opts: { provider: 'twilio' | 'telnyx'; secret: string },
): Promise<{ ok: false; status: 400 | 403 } | { ok: true; rawBody: string; params: Record<string, string> }> {
    if (!opts.secret) return { ok: false, status: 403 };

    let rawBody: string;
    try { rawBody = await c.req.text(); } catch { return { ok: false, status: 400 }; }

    // Lower-cased headers for the provider-agnostic signature context.
    const headers: Record<string, string> = {};
    c.req.raw.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
    const url = `${getBaseUrl(c)}${c.req.path}`;
    // Optional test seam: pin the anti-replay clock for Telnyx verification.
    const nowMs = (c.env as { TELNYX_VERIFY_NOW_MS?: number }).TELNYX_VERIFY_NOW_MS;

    if (opts.provider === 'telnyx') {
        const ok = await verifyTelnyxSignature(
            opts.secret,
            headers['telnyx-timestamp'] ?? '',
            rawBody,
            headers['telnyx-signature-ed25519'] ?? '',
            nowMs,
        );
        return ok ? { ok: true, rawBody, params: {} } : { ok: false, status: 403 };
    }

    // Twilio form-encoded — verify the HMAC over url + sorted params, parsed from
    // the raw body (byte-identical signature input to the prior formData() read).
    const params: Record<string, string> = {};
    for (const [k, v] of new URLSearchParams(rawBody)) params[k] = v;
    const presented = headers['x-twilio-signature'] ?? '';
    const ok = await validateTwilioSignature(opts.secret, url, params, presented);
    return ok ? { ok: true, rawBody, params } : { ok: false, status: 403 };
}

type DeliveryStatus = 'queued' | 'sent' | 'delivered' | 'undelivered' | 'failed';

type ParsedStatus = {
    eventId: string;
    providerMessageId: string;
    status: DeliveryStatus;
    errorCode: string | null;
};

/**
 * Status progression rank for the last-writer-wins guard. `delivered`,
 * `undelivered`, and `failed` are TERMINAL (a delivery either completed or
 * permanently failed) and share the top rank; once recorded they are never
 * overwritten. Lower ranks (`queued` < `sent`) only ever advance forward, so an
 * out-of-order callback (e.g. a delayed `sent` arriving after `delivered`)
 * cannot downgrade the status.
 */
const STATUS_RANK: Record<DeliveryStatus, number> = {
    queued: 0, sent: 1, delivered: 2, undelivered: 2, failed: 2,
};
const TERMINAL_STATUSES: ReadonlySet<DeliveryStatus> = new Set(['delivered', 'undelivered', 'failed']);

/**
 * Twilio status callback (form): MessageSid → providerMessageId; MessageStatus is
 * already one of the normalized words; ErrorCode (optional) → errorCode. The
 * event id is `${MessageSid}:${MessageStatus}` (stable per status transition).
 * Returns null when MessageSid/MessageStatus is absent or the status is unknown.
 */
function parseTwilioStatus(params: Record<string, string>): ParsedStatus | null {
    const sid = params.MessageSid;
    const raw = params.MessageStatus;
    if (!sid || !raw) return null;
    const allowed = ['queued', 'sent', 'delivered', 'undelivered', 'failed'] as const;
    if (!(allowed as readonly string[]).includes(raw)) return null;
    const errorCode = params.ErrorCode ? params.ErrorCode : null;
    return { eventId: `${sid}:${raw}`, providerMessageId: sid, status: raw as ParsedStatus['status'], errorCode };
}

/**
 * Telnyx delivery webhook (JSON). Only `message.sent` / `message.finalized`
 * carry a delivery status; any other event → null (no-op). providerMessageId =
 * data.payload.id. Delivery status is at data.payload.to[0].status; map
 * delivery_failed→failed, delivered→delivered, sent→sent, anything else → sent
 * (never crash). event id = data.id when present, else `${payload.id}:${status}`.
 * Guards every access; malformed JSON → null (the caller acks 200).
 */
function parseTelnyxStatus(rawBody: string): ParsedStatus | null {
    let parsed: unknown;
    try { parsed = JSON.parse(rawBody); } catch { return null; }
    const data = (parsed as { data?: { event_type?: unknown; id?: unknown; payload?: unknown } } | null)?.data;
    if (!data) return null;
    const eventType = data.event_type;
    if (eventType !== 'message.sent' && eventType !== 'message.finalized') return null;
    const payload = (data as { payload?: { id?: unknown; to?: unknown } }).payload;
    const messageId = payload?.id;
    if (typeof messageId !== 'string' || !messageId) return null;
    const to = Array.isArray(payload?.to) ? (payload.to as Array<{ status?: unknown }>) : [];
    const rawStatus = typeof to[0]?.status === 'string' ? (to[0].status as string) : '';
    let status: ParsedStatus['status'];
    switch (rawStatus) {
        case 'delivered': status = 'delivered'; break;
        case 'sent': status = 'sent'; break;
        case 'queued': status = 'queued'; break;
        default:
            // Telnyx negative outcomes (delivery_failed, sending_failed, expired,
            // rejected, webhook_failed, …) normalize to `failed` so a non-delivery
            // is never silently recorded as `sent`. Any other unknown finalize
            // status keeps `sent` (don't crash).
            status = /fail|reject|expir|undeliv/i.test(rawStatus) ? 'failed' : 'sent';
            break;
    }
    const errorCode = status === 'failed' && rawStatus ? rawStatus : null;
    const evId = typeof data.id === 'string' && data.id ? data.id : `${messageId}:${status}`;
    return { eventId: evId, providerMessageId: messageId, status, errorCode };
}

/**
 * Last-writer-wins upsert into sms_delivery_status keyed on
 * (tenant_id, provider_message_id). Inserts a fresh row when none exists; on an
 * existing row, only overwrites status/errorCode/updatedAt when the incoming
 * event time (`nowMs`) is >= the stored updatedAt — an OLDER (out-of-order)
 * callback never clobbers a newer status.
 */
async function upsertDeliveryStatus(
    db: DrizzleD1Database, tenantId: string, parsed: ParsedStatus, nowMs: number,
): Promise<void> {
    const existing = await db.select({ status: smsDeliveryStatus.status, updatedAt: smsDeliveryStatus.updatedAt })
        .from(smsDeliveryStatus)
        .where(and(eq(smsDeliveryStatus.tenantId, tenantId), eq(smsDeliveryStatus.providerMessageId, parsed.providerMessageId)))
        .get();
    if (!existing) {
        await db.insert(smsDeliveryStatus).values({
            id: crypto.randomUUID(), tenantId, providerMessageId: parsed.providerMessageId,
            status: parsed.status, errorCode: parsed.errorCode, updatedAt: new Date(nowMs),
        }).run();
        return;
    }
    // Status-rank guard (out-of-order safety): a terminal status is final, and the
    // status never moves backward in rank. Equal rank falls back to arrival time so
    // a genuine retry of the same stage still refreshes errorCode/updatedAt.
    const existingStatus = existing.status as DeliveryStatus;
    if (TERMINAL_STATUSES.has(existingStatus)) return;
    if (STATUS_RANK[parsed.status] < STATUS_RANK[existingStatus]) return;
    const storedMs = existing.updatedAt instanceof Date ? existing.updatedAt.getTime() : Number(existing.updatedAt);
    if (STATUS_RANK[parsed.status] === STATUS_RANK[existingStatus] && nowMs < storedMs) return;
    await db.update(smsDeliveryStatus)
        .set({ status: parsed.status, errorCode: parsed.errorCode, updatedAt: new Date(nowMs) })
        .where(and(eq(smsDeliveryStatus.tenantId, tenantId), eq(smsDeliveryStatus.providerMessageId, parsed.providerMessageId)))
        .run();
}

/**
 * WH-2 send-path id-stamping. Seeds a `sent` delivery-status row keyed on the
 * provider message id the moment a send is accepted, so a tenant has a record
 * before the delivery callback arrives (the callback's last-writer-wins upsert
 * then advances it). Non-fatal: a failed seed must never fail the send. Skip
 * when `providerMessageId` is absent (the provider returned no id).
 */
export async function recordSentStatus(
    db: DrizzleD1Database, tenantId: string, providerMessageId: string | undefined, nowMs: number,
): Promise<void> {
    if (!providerMessageId) return;
    await upsertDeliveryStatus(
        db, tenantId,
        { eventId: `${providerMessageId}:sent`, providerMessageId, status: 'sent', errorCode: null },
        nowMs,
    ).catch(() => { /* non-fatal side-write */ });
}

/**
 * Mount POST /sms/status/:tenant on the public SMS router. Tenant-scoped
 * delivery-status webhook: resolve tenant by slug, resolve provider (Twilio
 * default / Telnyx BYO) + verification secret exactly as the inbound /:tenant
 * route does, verify fail-closed (bad sig → 403 before any write), dedup on a
 * derived event_id, then last-writer-wins upsert the normalized status.
 */
export function registerSmsStatusRoute(router: Hono<HonoConfig>): void {
    router.post('/sms/status/:tenant', async (c) => {
        const slug = c.req.param('tenant');
        const db = drizzle(c.env.DB);
        const tenant = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug)).get();
        if (!tenant) return c.text('', 404);

        // Resolve the tenant's provider + verification secret — identical to inbound.
        let dec: Record<string, string | undefined> | null = null;
        try {
            dec = await loadTenantSecrets(
                c.env.DB, c.env.TENANT_CACHE, tenant.id, c.env.JWT_SECRET, c.env.JWT_SECRET_PREVIOUS,
            );
        } catch { /* no/undecryptable secrets — fall back below */ }
        const cfg = await db.select({ smsByoProvider: tenantConfigs.smsByoProvider })
            .from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenant.id)).get();

        let provider: 'twilio' | 'telnyx';
        let secret: string;
        if (cfg?.smsByoProvider === 'telnyx') {
            provider = 'telnyx';
            secret = dec?.['TELNYX_PUBLIC_KEY'] ?? '';
        } else {
            provider = 'twilio';
            secret = dec?.['TWILIO_AUTH_TOKEN'] || (c.env.TWILIO_AUTH_TOKEN ?? '');
        }

        const verified = await verifyInboundSignature(c, { provider, secret });
        if (!verified.ok) return c.text('', verified.status);

        // Plain-200 ack body, per provider (Twilio is happy with empty TwiML; Telnyx
        // expects a plain 2xx). Every HANDLED event returns 200, including no-ops.
        const ack = () => provider === 'telnyx'
            ? c.text('', 200)
            : c.text('<Response/>', 200, { 'Content-Type': 'text/xml' });

        const parsed = provider === 'telnyx'
            ? parseTelnyxStatus(verified.rawBody)
            : parseTwilioStatus(verified.params);
        if (!parsed) return ack(); // unrecognized/non-delivery event → acknowledged no-op

        const nowMs = (c.env as { WEBHOOK_NOW_MS?: number }).WEBHOOK_NOW_MS ?? Date.now();

        // Idempotency: insert the event id first; a duplicate (provider retry) short-
        // circuits to a no-op ack with no further write.
        try {
            await db.insert(processedWebhookEvents)
                .values({ eventId: parsed.eventId, receivedAt: new Date(nowMs) }).run();
        } catch {
            // Unique-violation on event_id ⇒ already processed ⇒ no-op.
            return ack();
        }

        await upsertDeliveryStatus(db, tenant.id, parsed, nowMs).catch(() => { /* non-fatal */ });
        return ack();
    });
}
