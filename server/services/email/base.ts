import { AppError, ErrorCode } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { buildIcs, type IcsEvent } from '../../lib/ics';
import { inspectorSignature, type SignatureUser } from '../../lib/inspector-signature';
import { resolveSenderIdentity, type EmailIdentityConfig, type SenderInspector } from '../../lib/email/sender-identity';
import { EmailTemplateRenderer } from '../../lib/email-templates/renderer';
import type { RenderResult } from '../../lib/email-templates/types';
import { ResendProvider } from '../../lib/email/providers/resend';
import type { EmailProvider } from '../../lib/email/provider';

/**
 * Sprint B-4 — when callers pass `inspector` + `host`, every customer-facing
 * automation appends the inspector's business-card signature to its HTML body
 * so customers can rebook with that specific inspector by clicking the link.
 * Legacy callers that omit the args get the unmodified body (no signature).
 */
export function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function appendSignature(html: string, inspector?: SignatureUser, host?: string): string {
    if (!inspector || !host) return html;
    const sig = inspectorSignature(inspector, host);
    return html + sig.html;
}

export function arrayBufferToBase64(buf: ArrayBuffer): string {
    const bytes = new Uint8Array(buf);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}

/**
 * Base for the EmailService domain split. Holds the constructor (dependency
 * injection), the core `sendEmail()` transport, the signature gate, the
 * registry/fallback render helper, and the one shared signature-injection
 * boilerplate (`renderWithSignature`) that every signature-bearing send method
 * funnels through. Domain mixins (transactional/agent/concierge/agreement/
 * inspection) extend this so they all share these protected members.
 *
 * Service to handle transactional email delivery using Resend.
 * Centralizes all email logic and formatting across the application.
 */
export class EmailBaseService {
    protected provider: EmailProvider;

    constructor(
        protected apiKey: string,
        protected senderEmail: string,
        protected appName: string,
        protected identity?: EmailIdentityConfig,
        protected renderer?: EmailTemplateRenderer,
        protected meter?: { record: () => Promise<void> },
        provider?: EmailProvider,
        /**
         * WH-3 — optional send-path suppression gate. When injected, `sendEmail`
         * drops any recipient that has hard-bounced or filed a complaint for this
         * tenant BEFORE the provider call (mirrors the SMS opt-out gate). Absent
         * (standalone/legacy callers) ⇒ no gate, behavior unchanged. Wired in
         * `assembleTenantEmailService` the same way `meter` is.
         */
        protected suppression?: { isSuppressed(email: string): Promise<boolean> },
        /**
         * Free-tier usage-quota pre-flight (2026-07 spec). When injected,
         * `sendEmail` awaits `quota.preflight()` BEFORE building or sending any
         * provider request — a quota block throws (402 QUOTA_EXHAUSTED) and the
         * send never reaches the provider and is never metered. Absent (BYO
         * sends, standalone/non-quota deployments, legacy callers) ⇒ no gate,
         * behavior unchanged. Wired in `assembleTenantEmailService` the same way
         * `meter` is.
         */
        protected quota?: { preflight: () => Promise<void> },
    ) {
        this.provider = provider ?? new ResendProvider({ apiKey: this.apiKey });
    }

    /** Render `trigger` via the template registry when a renderer is injected;
     *  otherwise use the provided fallback (keeps no-renderer unit tests working). */
    protected renderOr(trigger: string, data: Record<string, unknown>, fallback: { subject: string; html: string }, opts?: { signatureHtml?: string }): RenderResult {
        if (this.renderer) return this.renderer.render(trigger, data, opts);
        return { subject: fallback.subject, html: fallback.html, enabled: true };
    }

    /** Single gate for the email footer signature: requires inspector + host,
     *  honours the per-inspector toggle (default on), and suppresses a block
     *  that would have no name (avoids a half-empty footer). */
    protected signatureFor(inspector?: SignatureUser, host?: string): string | undefined {
        if (!inspector || !host) return undefined;
        if (inspector.signatureEnabled === false) return undefined;
        if (!(inspector.name ?? '').trim()) return undefined;
        return inspectorSignature(inspector, host).html;
    }

    /**
     * Shared signature-injection boilerplate. Every signature-bearing send
     * method resolves the inspector signature, then renders `trigger` with the
     * fallback body wrapped by `appendSignature` and the resolved signature
     * passed through as a render option. Extracted once so all call sites stay
     * byte-identical — equivalent to inlining:
     *   const signatureHtml = this.signatureFor(inspector, host);
     *   this.renderOr(trigger, data, { subject, html: appendSignature(fallbackBody, inspector, host) },
     *     signatureHtml ? { signatureHtml } : undefined);
     */
    protected renderWithSignature(
        trigger: string,
        data: Record<string, unknown>,
        subject: string,
        fallbackBody: string,
        inspector?: SignatureUser,
        host?: string,
    ): RenderResult {
        const signatureHtml = this.signatureFor(inspector, host);
        return this.renderOr(trigger, data, {
            subject,
            html: appendSignature(fallbackBody, inspector, host),
        }, signatureHtml ? { signatureHtml } : undefined);
    }

    /**
     * Sends a transactional email. Optionally includes binary attachments
     * (e.g. PDF reports) or text attachments (e.g. ICS calendar invites).
     * Resend's API expects each attachment as { filename, content }
     * where `content` is base64. The `contentType` field is optional —
     * Resend will infer from the filename extension when absent.
     */
    async sendEmail(
        to: string[],
        subject: string,
        html: string,
        attachments?: Array<{ filename: string; content: ArrayBuffer | string; contentType?: string }>,
        opts?: { inspector?: SenderInspector | undefined },
    ): Promise<{ delivered: boolean }> {
        // Free-tier pre-flight quota gate — runs BEFORE any provider request is
        // built. A quota block throws here, so no provider HTTP call is made
        // and no meter record happens for a send that never went out.
        await this.quota?.preflight();

        if (!this.apiKey || this.apiKey.includes('your_api_key')) {
            logger.warn(`[email] Skipping delivery (API Key missing) to: ${to.join(', ')}`);
            return { delivered: false };
        }

        // WH-3 — suppression gate: drop recipients that hard-bounced or complained
        // for this tenant BEFORE the provider call (mirrors the SMS opt-out gate).
        // Normalize each recipient EXACTLY as the webhook receiver stores them
        // (`.trim().toLowerCase()`) or the lookup silently never matches. FAIL-OPEN:
        // this is a best-effort deliverability guard, NOT a security control — a
        // lookup error must never block a legitimate send (the recipient stays).
        if (this.suppression) {
            const checked = await Promise.all(
                to.map(async (addr) => {
                    const normalized = addr.trim().toLowerCase();
                    try {
                        return { addr, suppressed: await this.suppression!.isSuppressed(normalized) };
                    } catch {
                        return { addr, suppressed: false }; // fail-open on lookup error
                    }
                }),
            );
            const allowed = checked.filter((r) => !r.suppressed).map((r) => r.addr);
            const suppressedCount = to.length - allowed.length;
            if (suppressedCount > 0) {
                // NO email/PII in the log — count only.
                logger.warn('[email] recipient(s) suppressed — skipping', { suppressedCount });
            }
            if (allowed.length === 0) {
                // All recipients suppressed: skip the provider entirely and return
                // the benign skip shape (identical to the missing-API-key skip — a
                // non-error value existing callers already treat as "not sent").
                return { delivered: false };
            }
            // Some allowed: send to the remaining recipients only.
            to = allowed;
        }

        const resolved = this.identity
            ? resolveSenderIdentity(this.identity, opts?.inspector)
            : {};

        if (!this.senderEmail) {
            logger.error('[email] No sender (From) address configured — refusing to send', { to });
            throw new AppError(502, ErrorCode.SERVICE_UNAVAILABLE, 'Email is not configured (no sender address).');
        }

        const from = resolved.fromName
            ? `${resolved.fromName} <${this.senderEmail}>`
            : this.senderEmail;

        // Build the Resend-shaped attachments (base64 encode) before passing to provider.
        const providerAttachments = attachments && attachments.length > 0
            ? attachments.map(a => {
                const base64 = typeof a.content === 'string'
                    ? btoa(unescape(encodeURIComponent(a.content)))
                    : arrayBufferToBase64(a.content);
                const out: { filename: string; content: string; content_type?: string } = {
                    filename: a.filename,
                    content: base64,
                };
                if (a.contentType) out.content_type = a.contentType;
                return out;
            })
            : undefined;

        const result = await this.provider.sendEmail({
            from,
            to,
            subject,
            html,
            ...(resolved.replyTo ? { replyTo: resolved.replyTo } : {}),
            ...(providerAttachments ? { attachments: providerAttachments } : {}),
        });

        if (!result.ok) {
            logger.error('[email] Delivery failed', { error: result.error });
            throw new AppError(502, ErrorCode.SERVICE_UNAVAILABLE, 'Email delivery failed');
        }

        // success — meter the send (best-effort; never blocks or breaks delivery).
        // Awaited (not waitUntil) so it works in scheduled/workflow contexts too.
        await this.meter?.record().catch(() => {});
        return { delivered: true };
    }

    /**
     * Sprint 1 C-10 — build a Resend-shaped attachment for an ICS calendar
     * invite. Caller passes the IcsEvent fields (uid, summary, etc.) and
     * gets back an attachment payload ready to drop into `sendEmail`.
     */
    icsAttachment(event: IcsEvent): { filename: string; content: string; contentType: string } {
        return {
            filename:    'inspection.ics',
            content:     buildIcs(event),
            contentType: 'text/calendar; charset=utf-8; method=REQUEST',
        };
    }
}

/** Mixin constructor shape for the domain sub-service mixins below. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Constructor<T = EmailBaseService> = new (...args: any[]) => T;
