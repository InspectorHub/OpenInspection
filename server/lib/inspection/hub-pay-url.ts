import type { Context } from 'hono';
import { getBookingHost } from '../url';
import { paymentUrl } from '../public-urls';
import type { HonoConfig } from '../../types/hono';

/**
 * The tokenized pay link the inspection hub hands out, or null.
 *
 * IA-34 — the public pay page refuses a bare `/invoice/:id`, so the hub's "copy
 * pay link" action must hand out the SAME tokenized URL the send path emails.
 * Minted here (route layer) rather than in the service so the aggregate query
 * stays free of the portal-access dependency; `issueToken` is idempotent and
 * reconstructs the existing plaintext instead of rotating, so re-reading the hub
 * never invalidates a link already in a client's inbox. Only for a SENT or part
 * paid invoice: a draft has no recipient bound yet.
 */
export async function hubPayUrl(
    c: Context<HonoConfig>,
    tenantId: string,
    inspectionId: string,
    invoice: { status: string } | null | undefined,
): Promise<string | null> {
    if (!invoice || (invoice.status !== 'sent' && invoice.status !== 'partial')) return null;
    const primaryClient = await c.var.services.people.getPrimaryClient(tenantId, inspectionId);
    if (!primaryClient?.email) return null;
    const payToken = await c.var.services.portalAccess.issueToken({
        tenantId, inspectionId, recipientEmail: primaryClient.email,
    });
    return paymentUrl(getBookingHost(c), inspectionId, payToken);
}
