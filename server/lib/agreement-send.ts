import type { Context } from 'hono';
import type { HonoConfig } from '../types/hono';
import type { SignatureUser } from './inspector-signature';
import { getBookingHost } from './url';
import { buildSignUrl } from './signature-helpers';
import { logger } from './logger';

/**
 * IA-65 — email every signer on an envelope their own signing link.
 *
 * One helper because there is one behaviour. The admin send and the
 * inspection-workspace send each carried their own copy of this loop, and they
 * had already drifted: the admin path called `buildSignUrl` (which upgrades to
 * the combined sign-and-pay link when the inspection owes money), the
 * inspection path called `agreementSignUrl` directly and always sent the plain
 * one. The client received a different email depending on which screen the
 * inspector happened to start from — and the workspace, the surface people
 * actually work from, was the one sending the weaker link.
 *
 * Terminal signers are skipped: a send aimed at the people beside them must not
 * re-ask someone who has already signed or declined.
 *
 * A signer whose link cannot be minted is logged and skipped rather than
 * aborting the batch — one broken token must not stop the other parties from
 * being asked to sign.
 */
export async function emailSignersTheirLinks(
    c: Context<HonoConfig>,
    opts: {
        tenantId: string;
        inspectionId: string | null | undefined;
        tenantSlug: string;
        requestId: string;
        agreementName: string;
        /**
         * Inspector identity for the email's rebooking footer (B-4a). Typed as
         * what the email template consumes, not as what either resolver
         * returns: the admin path resolves the tenant's sender identity and the
         * inspection path resolves the assigned inspector, and both are valid
         * inputs to the same footer.
         */
        senderSignature: SignatureUser | undefined;
        signers: Array<{ id: string; name: string | null; email: string; status: string }>;
    },
): Promise<void> {
    const host = getBookingHost(c);
    for (const s of opts.signers) {
        if (['signed', 'declined', 'expired'].includes(s.status)) continue;
        let signUrl: string;
        try {
            const token = await c.var.services.agreement.getSignerLink(opts.tenantId, opts.requestId, s.id);
            signUrl = await buildSignUrl(c, opts.tenantId, opts.inspectionId, opts.tenantSlug, token);
        } catch (e) {
            logger.warn('agreement.signer.link.failed', { signerId: s.id, error: e instanceof Error ? e.message : String(e) });
            continue;
        }
        await c.var.services.email
            .sendAgreementRequest(s.email, s.name, opts.agreementName, signUrl, opts.senderSignature, host)
            .catch((e: unknown) => logger.error('Failed to send agreement email', {}, e instanceof Error ? e : undefined));
    }
}
