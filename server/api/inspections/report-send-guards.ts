/**
 * Route guards for the endpoints that put a report in someone's inbox:
 * `send-report-pdf`, `share-agent` and `agent-token`, plus `send-sms`, which
 * shares the per-recipient hourly ceiling.
 *
 * Before these, the three ignored whether the report was published, accepted any
 * address in the body (a render token lets the PDF bypass the publish gate, so a
 * draft could be mailed to anyone), had no ceiling on recipients or repeats, and
 * did not ask whether the caller works the inspection.
 *
 * - every guard: caller must be assigned to the inspection or hold `scheduleOthers`
 *   (owner and manager always), and the report must be published (409 NOT_PUBLISHED,
 *   the public side's own code);
 * - send-report-pdf additionally: at most MAX_RECIPIENTS recipients, each one a
 *   person already on the inspection (by contact id, or by that person's email),
 *   and the same recipient is sent the same inspection at most MAX_PER_HOUR times
 *   per hour. The allowance counts reports DELIVERED: it is reserved before the
 *   send (so simultaneous requests cannot all pass the check) and given back for
 *   every recipient the send did not reach, or all of them when the request was
 *   refused (cooling window, plan cap) or failed.
 */
import type { Context, Next } from 'hono';
import { and, eq } from 'drizzle-orm';
import { inspections } from '../../lib/db/schema';
import { AppError, ErrorCode, Errors } from '../../lib/errors';
import { getDrizzle } from '../../lib/route-helpers';
import { assertMayActOnInspection } from '../../lib/inspection/assignment-access';
import { isReportPublished } from '../../lib/status/report-status';
import type { HonoConfig } from '../../types/hono';

const MAX_RECIPIENTS = 10;
const MAX_PER_HOUR = 3;

async function assertPublishedAndAssigned(c: Context<HonoConfig>, id: string): Promise<void> {
    const row = await getDrizzle(c).select({ reportStatus: inspections.reportStatus }).from(inspections)
        .where(and(eq(inspections.id, id), eq(inspections.tenantId, c.get('tenantId')))).get();
    if (!row) throw Errors.NotFound('Inspection not found');
    await assertMayActOnInspection(c, id, 'send this report');
    if (!isReportPublished(row.reportStatus)) {
        throw new AppError(409, ErrorCode.CONFLICT, 'This report is not published.', { code: 'NOT_PUBLISHED' });
    }
}

/** share-agent and agent-token. */
export async function guardReportLink(c: Context<HonoConfig>, next: Next) {
    await assertPublishedAndAssigned(c, c.req.param('id') ?? '');
    return next();
}

/** Longest contact id the SMS guard accepts; keeps the counter's KV key far below the 512-byte key limit. */
const MAX_CONTACT_ID_LENGTH = 128;

const sendKey = (c: Context<HonoConfig>, inspectionId: string, who: string) =>
    `sendlimit:${c.get('tenantId')}:${inspectionId}:${who.toLowerCase()}`;

/**
 * A counter is stored as `<count>@<expiry epoch ms>`: the expiry travels with the count so a refund can
 * put the count back down WITHOUT moving the window of the sends that really happened. (Rewriting the
 * key with a fresh TTL would keep an earlier delivery counted for longer than the hour it is owed.) The
 * window opens with the first send and does not slide: three sends in an hour is a ceiling on that hour.
 * A plain number is the older format; it reads as a count whose window ends an hour from now. A counter
 * whose window has passed reads as zero, whether or not the store has dropped the key yet.
 */
function readCounter(raw: string | null, nowMs: number): { count: number; expiresAtMs: number } {
    if (!raw) return { count: 0, expiresAtMs: nowMs + 3_600_000 };
    const [count, expiry] = raw.split('@');
    const parsed = Number(expiry);
    const expiresAtMs = Number.isFinite(parsed) && expiry ? parsed : nowMs + 3_600_000;
    if (expiresAtMs <= nowMs) return { count: 0, expiresAtMs: nowMs + 3_600_000 };
    return { count: Number(count) || 0, expiresAtMs };
}

/** Refuses when this recipient is already at the hourly ceiling for this inspection. Spends nothing. */
async function assertUnderLimit(c: Context<HonoConfig>, inspectionId: string, who: string, message: string): Promise<void> {
    const { count } = readCounter(await c.env.TENANT_CACHE.get(sendKey(c, inspectionId, who)), Date.now());
    if (count >= MAX_PER_HOUR) throw Errors.RateLimited(message);
}

/**
 * Moves one recipient's counter by `delta` (an address, or `sms:<contact id>`); never below zero. The
 * first spend opens the hour; later spends and refunds keep the expiry the counter already has.
 */
async function adjustSend(c: Context<HonoConfig>, inspectionId: string, who: string, delta: number): Promise<void> {
    const kv = c.env.TENANT_CACHE;
    const key = sendKey(c, inspectionId, who);
    const now = Date.now();
    const current = readCounter(await kv.get(key), now);
    const count = Math.max(0, current.count + delta);
    if (count === 0) {
        await kv.delete(key);
        return;
    }
    const expiresAtMs = current.expiresAtMs;
    // KV refuses an expiry less than a minute away; a window that short is simply held that long.
    await kv.put(key, `${count}@${expiresAtMs}`, { expiration: Math.max(Math.ceil(expiresAtMs / 1000), Math.ceil(now / 1000) + 60) });
}

/** Spends one send of this inspection on this recipient (an address, or `sms:<contact id>`). */
const spendSend = (c: Context<HonoConfig>, inspectionId: string, who: string) => adjustSend(c, inspectionId, who, 1);

/**
 * Which addresses a request really delivered to, noted by the handler as it goes. It is kept per
 * request so the guard knows what was delivered even when the handler then throws (a refusal that
 * applies to the whole batch aborts it after earlier recipients were already sent).
 */
const deliveredByRequest = new WeakMap<Request, string[]>();

/** Called by the send-report handler for each address a report actually went to. */
export function noteReportDelivered(c: Context<HonoConfig>, email: string): void {
    const list = deliveredByRequest.get(c.req.raw) ?? [];
    list.push(email.toLowerCase());
    deliveredByRequest.set(c.req.raw, list);
}

/**
 * Serialises the check-then-write on one inspection's counters within this isolate. KV has no
 * atomic increment, so without this two requests in flight (a double-click) both read the same
 * count, both pass the check and both write count + 1. Across isolates the counter stays
 * best-effort, as KV reads are eventually consistent; the ceiling is a courtesy limit, not a
 * security boundary.
 */
const counterLocks = new Map<string, Promise<void>>();
async function withCounterLock<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = counterLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => mine);
    counterLocks.set(key, tail);
    await previous;
    try {
        return await work();
    } finally {
        release();
        if (counterLocks.get(key) === tail) counterLocks.delete(key);
    }
}

/**
 * Called by the send-sms handler for each recipient a text actually went to.
 * A recipient that was skipped (no consent, no phone, not seated, provider
 * failure) spends nothing, so the ceiling counts texts sent, not texts asked for.
 */
export async function recordSmsSent(c: Context<HonoConfig>, inspectionId: string, contactId: string): Promise<void> {
    await spendSend(c, inspectionId, `sms:${contactId}`);
}

const REPORT_LIMIT_MESSAGE = 'This report was already sent to that recipient several times in the last hour.';
const SMS_LIMIT_MESSAGE = 'A text was already sent to that recipient several times in the last hour.';

interface RawRecipient { contactId?: string; email?: string; roleKey: string }

/** The body shape the schema will also demand; checked here first because guards run before validation. */
function readRecipients(raw: unknown): RawRecipient[] | null {
    const list = raw && typeof raw === 'object' ? (raw as { recipients?: unknown }).recipients : undefined;
    if (!Array.isArray(list) || list.length === 0) return null;
    const out: RawRecipient[] = [];
    for (const r of list) {
        if (!r || typeof r !== 'object') throw Errors.BadRequest('Each recipient must be an object.');
        const { contactId, email, roleKey } = r as Record<string, unknown>;
        if ((contactId !== undefined && typeof contactId !== 'string') || (email !== undefined && typeof email !== 'string')
            || typeof roleKey !== 'string' || roleKey.length === 0 || (!contactId && !email)) {
            throw Errors.BadRequest('Each recipient needs a roleKey and a contactId or an email.');
        }
        out.push({ ...(contactId ? { contactId } : {}), ...(email ? { email } : {}), roleKey });
    }
    return out;
}

/** send-report-pdf. */
export async function guardSendReport(c: Context<HonoConfig>, next: Next) {
    const id = c.req.param('id') ?? '';
    await assertPublishedAndAssigned(c, id);
    const recipients = readRecipients(await c.req.json().catch(() => null));
    if (!recipients) return next(); // no recipients: the schema answers 400
    if (recipients.length > MAX_RECIPIENTS) {
        throw Errors.BadRequest(`A report can be sent to at most ${MAX_RECIPIENTS} recipients at a time.`);
    }
    const people = await c.var.services.people.listPeople(c.get('tenantId'), id);
    const seen = new Set<string>();
    const emails: string[] = [];
    for (const r of recipients) {
        const person = people.find((p) => (r.contactId && p.contactId === r.contactId)
            || (!r.contactId && r.email && p.email?.toLowerCase() === r.email.toLowerCase()));
        if (!person) throw Errors.BadRequest('Recipients must be people on this inspection (client, co-client or linked agents).');
        // A contact id with a different typed email is the contact's address, never the typed one.
        if (r.contactId && r.email && person.email?.toLowerCase() !== r.email.toLowerCase()) {
            throw Errors.BadRequest('Recipient email does not match the contact on this inspection.');
        }
        if (seen.has(person.contactId)) throw Errors.BadRequest('Each recipient can be listed only once.');
        seen.add(person.contactId);
        if (person.email) emails.push(person.email.toLowerCase());
    }
    // Reserve the allowance only once the whole request has passed every check above. Check every
    // recipient first so a request refused for one of them has reserved nothing for the others, and
    // do check and reservation under one lock so two simultaneous requests cannot both pass.
    const lockKey = `${c.get('tenantId')}:${id}`;
    await withCounterLock(lockKey, async () => {
        for (const email of emails) await assertUnderLimit(c, id, email, REPORT_LIMIT_MESSAGE);
        for (const email of emails) await spendSend(c, id, email);
    });
    // The reservation is only a hold until the send is known. Whatever happens next (an answer, a
    // thrown refusal), give back exactly the recipients the handler did not deliver to.
    try {
        await next();
    } finally {
        await releaseUndelivered(c, id, lockKey, emails, deliveredByRequest.get(c.req.raw) ?? []);
    }
}

async function releaseUndelivered(
    c: Context<HonoConfig>, inspectionId: string, lockKey: string, reserved: string[], delivered: string[],
): Promise<void> {
    const remaining = new Map<string, number>();
    for (const email of delivered) remaining.set(email, (remaining.get(email) ?? 0) + 1);
    const refunds: string[] = [];
    for (const email of reserved) {
        const left = remaining.get(email) ?? 0;
        if (left > 0) remaining.set(email, left - 1);
        else refunds.push(email);
    }
    if (refunds.length === 0) return;
    // A failed refund must never turn a finished send into an error; the hold simply expires with its hour.
    await withCounterLock(lockKey, async () => {
        for (const email of refunds) await adjustSend(c, inspectionId, email, -1).catch(() => {});
    }).catch(() => {});
}

/** report-link-expiry on one inspection: assigned or `scheduleOthers`, publish state irrelevant. */
export async function guardLinkExpiry(c: Context<HonoConfig>, next: Next) {
    await assertMayActOnInspection(c, c.req.param('id') ?? '', "change this inspection's report links");
    return next();
}

/**
 * send-sms: assigned or `scheduleOthers`, at most MAX_RECIPIENTS people per
 * request, each person listed once, and each person texted at most MAX_PER_HOUR
 * times per hour per inspection (the same counter the report sends use). The
 * TCPA gate and the seated-person check stay the handler's. This guard only
 * READS the counters; the handler spends one (`recordSmsSent`) per recipient it
 * really texted, so a refused request, or a recipient it skips, spends nothing.
 */
export async function guardSendSms(c: Context<HonoConfig>, next: Next) {
    const id = c.req.param('id') ?? '';
    await assertMayActOnInspection(c, id, 'text its clients');
    const list = readSmsContactIds(await c.req.json().catch(() => null));
    if (!list) return next(); // malformed or empty: the schema answers 400
    if (list.length > MAX_RECIPIENTS) {
        throw Errors.BadRequest(`A text can go to at most ${MAX_RECIPIENTS} people at a time.`);
    }
    if (new Set(list).size !== list.length) throw Errors.BadRequest('Each recipient can be listed only once.');
    for (const contactId of list) await assertUnderLimit(c, id, `sms:${contactId}`, SMS_LIMIT_MESSAGE);
    return next();
}

/** The contact ids in a send-sms body, or null when the body is not the shape the schema will accept. */
function readSmsContactIds(raw: unknown): string[] | null {
    const list = raw && typeof raw === 'object' ? (raw as { recipients?: unknown }).recipients : undefined;
    if (!Array.isArray(list) || list.length === 0) return null;
    const ids: string[] = [];
    for (const r of list) {
        const contactId = r && typeof r === 'object' ? (r as { contactId?: unknown }).contactId : undefined;
        if (typeof contactId !== 'string' || contactId.length === 0) return null;
        if (contactId.length > MAX_CONTACT_ID_LENGTH) throw Errors.BadRequest('A contact id is too long.');
        ids.push(contactId);
    }
    return ids;
}
