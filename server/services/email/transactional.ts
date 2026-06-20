import { type SignatureUser } from '../../lib/inspector-signature';
import { escapeHtml, type Constructor } from './base';

/**
 * Transactional / account email methods: password reset, workspace
 * invitation, invoice payment request, and the in-thread message
 * notification. Mixed into EmailService — see `email.service.ts`.
 */
export function TransactionalEmailMixin<TBase extends Constructor>(Base: TBase) {
    return class TransactionalEmail extends Base {
        /**
         * Sends a password reset email.
         */
        async sendPasswordReset(to: string, resetLink: string) {
            const fallbackBody = `<p>Click the link below to reset your ${this.appName} password. This link expires in 1 hour.</p>
             <p><a href="${resetLink}" style="background:#4f46e5;color:#fff;padding:10px 20px;text-decoration:none;border-radius:6px;">Reset Password</a></p>
             <p style="font-size:12px;color:#999;">If you didn't request this, ignore this email. Link: ${resetLink}</p>`;
            const rendered = this.renderOr('password-reset', { resetLink }, {
                subject: 'Reset your password',
                html: fallbackBody,
            });
            if (!rendered.enabled) return;
            await this.sendEmail([to], rendered.subject, rendered.html);
        }

        /**
         * Sends a workspace invitation email.
         */
        async sendInvitation(to: string, inviteLink: string) {
            const fallbackBody = `<p>You've been invited to join an ${this.appName} workspace.</p>
             <p><a href="${inviteLink}" style="background:#4f46e5;color:#fff;padding:10px 20px;text-decoration:none;border-radius:6px;">Accept Invitation</a></p>
             <p style="font-size:12px;color:#999;">Link expires in 7 days. If the button doesn't work: ${inviteLink}</p>`;
            const rendered = this.renderOr('workspace-invitation', { inviteLink, tenantName: this.appName }, {
                subject: "You've been invited to join a workspace",
                html: fallbackBody,
            });
            if (!rendered.enabled) return;
            await this.sendEmail([to], rendered.subject, rendered.html);
        }

        /**
         * Task 8 (Issue #111) — emails the client a request to pay their invoice,
         * linking the public `/invoice/:id` payment page. Mirrors
         * sendAgreementRequest: registry-driven render with a branded fallback and
         * the inspector's rebooking signature (B-4) when host + inspector are given.
         */
        async sendInvoiceRequest(to: string, clientName: string | null, amountLabel: string, payUrl: string, inspector?: SignatureUser, host?: string) {
            const name = escapeHtml(clientName || 'Client');
            const fallbackBody = `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px;">
                <h2 style="color: #4f46e5;">Payment Request</h2>
                <p>Hi ${name},</p>
                <p>Your invoice is ready. The amount due is:</p>
                <p style="font-weight: bold; font-size: 20px; color: #1e293b;">${escapeHtml(amountLabel)}</p>
                <div style="margin: 32px 0;">
                    <a href="${payUrl}" style="background: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold;">View &amp; Pay Invoice</a>
                </div>
                <p style="font-size: 14px; color: #64748b;">If the button doesn't work, copy and paste this link: ${payUrl}</p>
                <p style="color: #64748b; font-size: 14px; margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 10px;">
                    Thank you,<br>${this.appName} Team
                </p>
            </div>`;
            const rendered = this.renderWithSignature(
                'payment-request',
                { clientName: clientName ?? 'Client', amount: amountLabel, payUrl },
                `Payment request: ${amountLabel}`,
                fallbackBody,
                inspector,
                host,
            );
            if (!rendered.enabled) return;
            await this.sendEmail(
                [to],
                rendered.subject,
                rendered.html,
                undefined,
                { inspector },
            );
        }

        /**
         * Phase T (T22): Send a notification email to the other party when a new message arrives.
         * Throttled per inspection per direction via TENANT_CACHE KV (5 min window).
         * recipient: 'client' = email client; 'inspector' = email inspector
         */
        async sendMessageNotification(
            recipient: 'client' | 'inspector',
            inspectionId: string,
            message: { body: string; fromName?: string | null },
            deps: { db: D1Database; kv?: KVNamespace; baseUrl: string; clientViewUrl?: string },
        ): Promise<void> {
            if (!this.apiKey) return;
            const throttleKey = `msg_notify:${inspectionId}:${recipient}`;
            if (deps.kv) {
                const recent = await deps.kv.get(throttleKey);
                if (recent) return;
            }

            const { drizzle } = await import('drizzle-orm/d1');
            const { inspections, users } = await import('../../lib/db/schema');
            const { eq, and } = await import('drizzle-orm');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const db = drizzle(deps.db as any);
            const [insp] = await db.select().from(inspections).where(eq(inspections.id, inspectionId)).limit(1);
            if (!insp) return;

            let to: string | null = null;
            let viewUrl = '';
            if (recipient === 'client') {
                to = insp.clientEmail ?? null;
                // The client now reads messages in the unified portal Hub. The caller
                // (inspector send route) mints a per-recipient portal token and builds
                // the section deep-link, mirroring the report-ready email. If it is
                // absent (best-effort failure upstream) we fall back to the portal Hub
                // overview without a token rather than a now-dead /messages/:token URL.
                viewUrl = deps.clientViewUrl || `${deps.baseUrl}/portal`;
            } else {
                if (insp.inspectorId) {
                    const [u] = await db.select().from(users)
                        .where(and(eq(users.id, insp.inspectorId), eq(users.tenantId, insp.tenantId)))
                        .limit(1);
                    to = u?.email ?? null;
                }
                viewUrl = `${deps.baseUrl}/inspections/${insp.id}/edit`;
            }
            if (!to) return;

            const escape = escapeHtml;
            const fromName = (message.fromName ?? (recipient === 'client' ? 'your inspector' : (insp.clientName ?? 'your client'))).toString();
            const snippet = message.body.length > 200 ? message.body.slice(0, 197) + '...' : message.body;
            const fallbackBody = `
            <p>New message from <strong>${escape(fromName)}</strong> regarding <strong>${escape(insp.propertyAddress ?? '')}</strong>:</p>
            <blockquote style="border-left:3px solid #ccc;padding-left:12px;color:#555">${escape(snippet)}</blockquote>
            <p><a href="${viewUrl}">View conversation</a></p>
        `;
            const rendered = this.renderOr('message-notification', { fromName, propertyAddress: insp.propertyAddress ?? '', snippet, viewUrl }, {
                subject: `New message — ${insp.propertyAddress ?? 'inspection'}`,
                html: fallbackBody,
            });
            if (!rendered.enabled) return;
            await this.sendEmail([to], rendered.subject, rendered.html);
            if (deps.kv) await deps.kv.put(throttleKey, '1', { expirationTtl: 300 });
        }
    };
}
