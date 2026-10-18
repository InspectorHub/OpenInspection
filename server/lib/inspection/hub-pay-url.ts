import type { Context } from 'hono';
import { getBookingHost } from '../url';
import { paymentUrl } from '../public-urls';
import { logger } from '../logger';
import { AppError } from '../errors';
import type { HonoConfig } from '../../types/hono';

/**
 * The tokenized pay link the inspection hub hands out, and why there is none when there is none.
 *
 * IA-34 — the public pay page refuses a bare `/invoice/:id`, so the hub's "copy
 * pay link" action must hand out the SAME tokenized URL the send path emails.
 * Minted here (route layer) rather than in the service so the aggregate query
 * stays free of the portal-access dependency; `issueToken` is idempotent and
 * reconstructs the existing plaintext instead of rotating, so re-reading the hub
 * never invalidates a link already in a client's inbox. Only for a SENT or part
 * paid invoice: a draft has no recipient bound yet.
 *
 * Both reads and the single write inside `issueToken` happen before it touches the grant (one INSERT, or one UPDATE
 * that re-arms a revoked row), so a failing later read cannot leave a half-written grant.
 *
 * The link is a convenience on a READ. When it cannot be produced (a portal grant
 * stored without its sealed token, so the existing link cannot be reconstructed;
 * a missing secret) the hub still loads and the pay link is simply absent. It used
 * to fail the whole hub with a 500 for anyone holding `companyFinance`, which is
 * every owner and manager, on any inspection whose invoice had been sent.
 */
/** Why the hub has no pay link to show, when it has none for a reason the viewer could act on. */
type HubPayLinkGap = 'no_client_email' | 'link_error';
export interface HubPayLink {
    url: string | null;
    /** Null when a link was produced, or none was due (a draft, no invoice). */
    unavailable: HubPayLinkGap | null;
}

const EMAIL_LIKE = /[^\s@"'<>(),;]+@[^\s@"'<>(),;]+/g;
const URL_LIKE = /https?:\/\/\S+/gi;
const TOKEN_LIKE = /[A-Za-z0-9_-]{24,}/g;

/** A failure's message with anything that could identify the client or open the link taken out, and bounded. */
export function scrubbedMessage(err: Error): string {
    return err.message.replace(URL_LIKE, '[url]').replace(EMAIL_LIKE, '[email]').replace(TOKEN_LIKE, '[token]').slice(0, 300);
}

export async function hubPayLink(
    c: Context<HonoConfig>,
    tenantId: string,
    inspectionId: string,
    invoice: { status: string } | null | undefined,
): Promise<HubPayLink> {
    if (!invoice || (invoice.status !== 'sent' && invoice.status !== 'partial')) return { url: null, unavailable: null };
    try {
        const primaryClient = await c.var.services.people.getPrimaryClient(tenantId, inspectionId);
        if (!primaryClient?.email) return { url: null, unavailable: 'no_client_email' };
        const payToken = await c.var.services.portalAccess.issueToken({
            tenantId, inspectionId, recipientEmail: primaryClient.email,
        });
        return { url: paymentUrl(getBookingHost(c), inspectionId, payToken), unavailable: null };
    } catch (err) {
        // Our own errors (AppError) carry text written by us and are an expected "cannot produce it" (warn).
        // Anything else is a fault (a database outage, a programming error) and must stay visible to error alerting.
        // A wrapped database failure can repeat its bound parameters, which here include the client's email, so the
        // message is scrubbed of emails, URLs and token-shaped strings before it is written.
        if (err instanceof AppError) {
            logger.warn('hub pay link not produced; the hub loads without it', { inspectionId, reason: err.message });
        } else {
            logger.error('hub pay link failed unexpectedly; the hub loads without it', {
                inspectionId,
                errorClass: err instanceof Error ? err.name : typeof err,
                reason: err instanceof Error ? scrubbedMessage(err) : 'non-error thrown',
            });
        }
        return { url: null, unavailable: 'link_error' };
    }
}
