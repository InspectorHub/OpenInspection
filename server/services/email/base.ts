import { AppError, ErrorCode } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { buildIcs, type IcsEvent } from '../../lib/ics';
import { inspectorSignature, type SignatureUser } from '../../lib/inspector-signature';
import { resolveSenderIdentity, type EmailIdentityConfig, type SenderInspector } from '../../lib/email/sender-identity';
import { EmailTemplateRenderer } from '../../lib/email-templates/renderer';
import type { RenderResult } from '../../lib/email-templates/types';

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
    constructor(
        protected apiKey: string,
        protected senderEmail: string,
        protected appName: string,
        protected identity?: EmailIdentityConfig,
        protected renderer?: EmailTemplateRenderer,
        protected meter?: { record: () => Promise<void> },
    ) {}

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
        if (!this.apiKey || this.apiKey.includes('your_api_key')) {
            logger.warn(`[email] Skipping delivery (API Key missing) to: ${to.join(', ')}`);
            return { delivered: false };
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

        const payload: Record<string, unknown> = {
            from,
            to,
            subject,
            html,
        };
        if (resolved.replyTo) payload.reply_to = resolved.replyTo;

        if (attachments && attachments.length > 0) {
            payload.attachments = attachments.map(a => {
                const base64 = typeof a.content === 'string'
                    ? btoa(unescape(encodeURIComponent(a.content)))
                    : arrayBufferToBase64(a.content);
                const out: Record<string, string> = {
                    filename: a.filename,
                    content: base64,
                };
                if (a.contentType) out.content_type = a.contentType;
                return out;
            });
        }

        try {
            const res = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                const text = await res.text();
                logger.error('[email] Resend delivery failed', { response: text });
                throw new AppError(502, ErrorCode.SERVICE_UNAVAILABLE, 'Email delivery failed');
            }
            // success — meter the send (best-effort; never blocks or breaks delivery).
            // Awaited (not waitUntil) so it works in scheduled/workflow contexts too.
            await this.meter?.record().catch(() => {});
            return { delivered: true };
        } catch (err) {
            logger.error('[email] Delivery exception', {}, err instanceof Error ? err : undefined);
            throw new AppError(502, ErrorCode.SERVICE_UNAVAILABLE, 'Email service unavailable');
        }
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
