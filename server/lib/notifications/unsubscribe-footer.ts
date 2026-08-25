/**
 * The footer that makes the unsubscribe link reach people, and the delivery
 * shape it forces.
 *
 * ── Why this is per-recipient, and why that changes the provider call ───────
 * The token names ONE address (`unsubscribe-token.ts`), so two recipients of
 * the same message cannot share a link — a shared one would let either of them
 * switch the other off. A single provider call with `to: [a, b]` carries one
 * HTML body, so the moment a footer applies the send has to become one call per
 * recipient. That is the whole reason `deliverWithUnsubscribe` exists rather
 * than a string helper.
 *
 * For the overwhelmingly common single-recipient notification this is byte-for-
 * byte the call that was made before. For the rare multi-recipient one it is N
 * calls, which is also the more correct behaviour: one bad address no longer
 * takes the others down with it.
 *
 * ── Only where there is something to switch off ─────────────────────────────
 * `isSuppressible` decides. A notification the recipient is told is always sent
 * — their report, their agreement, their receipt — gets NO footer, because a
 * link that leads to "this cannot be switched off" is a control that lies, and
 * a person who clicks it has been told they have a choice they do not have.
 */
import { isSuppressible } from './classes';
import { signUnsubscribeToken, unsubscribeUrl } from './unsubscribe-token';
import type { EmailProvider, EmailSendArgs } from '../email/provider';

/**
 * Mints the link for one (class, address). Returns null when this send has no
 * tenant, no secret or no base URL to build an absolute link from — an email
 * carrying a relative unsubscribe URL is an email with no unsubscribe at all.
 */
export interface UnsubscribeLinkPort {
    linkFor(classId: string, email: string): Promise<string | null>;
}

/**
 * Appended, not inserted. `EmailLayout` closes the document, and rather than
 * teach the layout about a recipient it has never known, the footer rides after
 * it — every mail client renders trailing block content, and the alternative is
 * a string surgery on generated HTML that breaks the first time the layout
 * changes.
 */
// Not exported: the only caller is `deliverWithUnsubscribe` below. Exporting it
// would offer a footer builder to code that has no token to put in it.
function unsubscribeFooterHtml(url: string): string {
    return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fafc;">
  <tr><td align="center" style="padding:0 16px 24px 16px;">
    <p style="margin:0;font-size:11px;line-height:1.6;color:#94a3b8;">
      Don't want these emails?
      <a href="${url}" style="color:#94a3b8;text-decoration:underline;">Unsubscribe from this notification</a>.
      Messages about your inspection itself — your report, agreements and receipts — are sent either way.
    </p>
  </td></tr>
</table>`;
}

/** Everything the provider needs except the two things that vary per recipient. */
export type SendEnvelope = Omit<EmailSendArgs, 'to' | 'html'>;

type SendResult = Awaited<ReturnType<EmailProvider['sendEmail']>>;

/**
 * Deliver `html` to `to`, giving each recipient their own unsubscribe footer
 * when the class allows one.
 *
 * Returns the FIRST failure when the send fanned out, so a caller that treats a
 * non-ok result as fatal keeps doing so. Reporting only the last result would
 * let one success at the end of the list hide four failures before it.
 */
export async function deliverWithUnsubscribe(
    provider: EmailProvider,
    envelope: SendEnvelope,
    to: string[],
    html: string,
    links: UnsubscribeLinkPort | undefined,
    classId: string | undefined,
): Promise<SendResult> {
    if (!links || !classId || !isSuppressible(classId) || to.length === 0) {
        return provider.sendEmail({ ...envelope, to, html });
    }

    const bodies = await Promise.all(to.map(async (addr) => {
        // FAIL-OPEN, like every other gate on this path: a link we could not
        // mint must never be the reason the message did not go out.
        let url: string | null = null;
        try { url = await links.linkFor(classId, addr); } catch { /* leave null: send without the footer */ }
        return { addr, html: url ? `${html}\n${unsubscribeFooterHtml(url)}` : html };
    }));

    const results = await Promise.all(
        bodies.map((b) => provider.sendEmail({ ...envelope, to: b.addr, html: b.html })),
    );
    return results.find((r) => !r.ok) ?? results[0]!;
}

/** Build the port for one tenant. `null` for anything it cannot sign or address. */
export function buildUnsubscribeLinks(
    tenantId: string, secret: string | undefined, baseUrl: string | undefined,
): UnsubscribeLinkPort {
    return {
        async linkFor(classId: string, email: string): Promise<string | null> {
            if (!secret || !baseUrl) return null;
            return unsubscribeUrl(baseUrl, await signUnsubscribeToken(secret, { tenantId, email, classId }));
        },
    };
}
