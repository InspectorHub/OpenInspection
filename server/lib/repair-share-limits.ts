/**
 * Bounds for the two public repair-request share actions that cost something: rendering the page to a PDF, and emailing the link to
 * an address the caller types.
 *
 * The share token is the only credential, and any holder (a contractor, an agent, the other side of the transaction) can press both
 * buttons. Without a bound the email button is a relay that sends branded mail from the inspection company's domain to anyone, with
 * text of the caller's choosing, and the PDF button starts a headless-browser render on every press.
 *
 * Nested limits for the email: the per-minute limiter per source address (the visitor's network, IPv6 as its /64), per share token, per
 * company and per recipient mailbox (bursts), and a per-day count per share token and per recipient mailbox (a slow drip).
 *
 * The per-day counts are a BOUND, not an exact quota: they live in the tenant cache KV, which is eventually consistent, and each is
 * read and then written, so concurrent sends can slip a few past the ceiling. That is acceptable for abuse control and would not be
 * for billing.
 *
 * The per-company bucket is shared by every holder of every link of that company, so one holder can use it up for the minute and
 * block the others. That is the cost of having a ceiling on what one company's domain sends; the per-link and per-address buckets
 * keep a single holder from being the only one to hit it for long.
 */
import type { Context } from 'hono';
import type { HonoConfig } from '../types/hono';
import { Errors } from './errors';
import { checkRateLimit } from './rate-limit';
import { sha256Hex } from './sha256';

/** Emails one share link may send in a day. */
const SHARE_EMAIL_PER_TOKEN_PER_DAY = 20;
/** Emails to one address, from any link of one company, in a day. */
const SHARE_EMAIL_PER_RECIPIENT_PER_DAY = 3;
/** The longest personal note the email carries. */
export const SHARE_EMAIL_MESSAGE_MAX = 1000;

/**
 * The mailbox an address delivers to, for counting: lowercased, a `+tag` dropped from the local part, and for Gmail the dots in the
 * local part dropped too (`J.o+x@googlemail.com` and `jo@gmail.com` are one mailbox). Other providers' dots are significant, so they stay.
 */
export function mailboxKey(address: string): string {
    const lower = address.trim().toLowerCase();
    const at = lower.lastIndexOf('@');
    if (at < 1) return lower;
    let local = lower.slice(0, at);
    let domain = lower.slice(at + 1);
    const plus = local.indexOf('+');
    if (plus > 0) local = local.slice(0, plus);
    if (domain === 'googlemail.com') domain = 'gmail.com';
    if (domain === 'gmail.com') local = local.replace(/\./g, '');
    return `${local}@${domain}`;
}

/** A short digest of a share token, so the token itself never becomes a limiter or KV key. */
async function digest(value: string): Promise<string> {
    return (await sha256Hex(value)).slice(0, 24);
}

/** Today's key for one daily counter. */
function dailyKey(key: string): string {
    return `share-limit:${key}:${new Date().toISOString().slice(0, 10)}`;
}

async function used(kv: KVNamespace, key: string): Promise<number> {
    return parseInt((await kv.get(dailyKey(key))) ?? '0', 10) || 0;
}

/** Throws RateLimited unless this PDF render may start. Called only on a cache miss, so serving a stored copy is free. */
export async function boundSharePdf(c: Context<HonoConfig>, tenantId: string, shareToken: string): Promise<void> {
    await checkRateLimit(c, 'repair-share-pdf', await digest(shareToken));
    // Shared by every holder of the company's links (see the header): one holder can use the minute's allowance up.
    await checkRateLimit(c, 'repair-share-pdf-company', tenantId);
}

/** Throws RateLimited unless this email may be sent. */
export async function boundShareEmail(c: Context<HonoConfig>, tenantId: string, shareToken: string, to: string): Promise<void> {
    const tokenKey = await digest(shareToken);
    const recipientKey = await digest(`${tenantId}:${mailboxKey(to)}`);
    // No scope: the limiter keys on the visitor's address (CF-Connecting-IP, normalised to its network by the shared limiter), so one
    // source cannot spread sends across links, recipients or companies.
    await checkRateLimit(c, 'repair-share-email-ip');
    await checkRateLimit(c, 'repair-share-email', tokenKey);
    // Shared by every holder of the company's links (see the header): one holder can use the minute's allowance up.
    await checkRateLimit(c, 'repair-share-email-company', tenantId);
    await checkRateLimit(c, 'repair-share-email-to', recipientKey);
    const kv = c.env.TENANT_CACHE;
    if (!kv) return;
    // Both ceilings are read before either counter moves, so a send refused for one reason does not use up the other's allowance.
    const [byToken, byRecipient] = await Promise.all([used(kv, `token:${tokenKey}`), used(kv, `to:${recipientKey}`)]);
    if (byToken >= SHARE_EMAIL_PER_TOKEN_PER_DAY || byRecipient >= SHARE_EMAIL_PER_RECIPIENT_PER_DAY) throw Errors.RateLimited();
    const ttl = { expirationTtl: 60 * 60 * 26 };
    await Promise.all([
        kv.put(dailyKey(`token:${tokenKey}`), String(byToken + 1), ttl),
        kv.put(dailyKey(`to:${recipientKey}`), String(byRecipient + 1), ttl),
    ]);
}
