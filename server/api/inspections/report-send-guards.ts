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
 *   per hour.
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

/** Refuses when this recipient is already at the hourly ceiling for this inspection. Spends nothing. */
async function assertUnderLimit(c: Context<HonoConfig>, inspectionId: string, who: string, message: string): Promise<void> {
    const used = Number(await c.env.TENANT_CACHE.get(sendKey(c, inspectionId, who)) ?? '0');
    if (used >= MAX_PER_HOUR) throw Errors.RateLimited(message);
}

/** Spends one send of this inspection on this recipient (an address, or `sms:<contact id>`). */
async function spendSend(c: Context<HonoConfig>, inspectionId: string, who: string): Promise<void> {
    const kv = c.env.TENANT_CACHE;
    const key = sendKey(c, inspectionId, who);
    const used = Number(await kv.get(key) ?? '0');
    await kv.put(key, String(used + 1), { expirationTtl: 3600 });
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
    // Quota is spent only once the whole request has passed every check above.
    // Check every recipient first so a request refused for one of them has spent nothing for the others.
    for (const email of emails) await assertUnderLimit(c, id, email, REPORT_LIMIT_MESSAGE);
    for (const email of emails) await spendSend(c, id, email);
    return next();
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
