import { AppError, ErrorCode } from '../lib/errors';
import { logger } from '../lib/logger';
import { buildIcs, type IcsEvent } from '../lib/ics';

/**
 * Service to handle transactional email delivery using Resend.
 * Centralizes all email logic and formatting across the application.
 */
export class EmailService {
    constructor(private apiKey: string, private senderEmail: string, private appName: string) {}

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
    ) {
        if (!this.apiKey || this.apiKey.includes('your_api_key')) {
            logger.warn(`[email] Skipping delivery (API Key missing) to: ${to.join(', ')}`);
            return;
        }

        const payload: Record<string, unknown> = {
            from: this.senderEmail || `${this.appName} <noreply@example.com>`,
            to,
            subject,
            html,
        };

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
        } catch (err) {
            logger.error('[email] Delivery exception', {}, err instanceof Error ? err : undefined);
            throw new AppError(502, ErrorCode.SERVICE_UNAVAILABLE, 'Email service unavailable');
        }
    }

    /**
     * Sends a password reset email.
     */
    async sendPasswordReset(to: string, resetLink: string) {
        await this.sendEmail(
            [to],
            'Reset your password',
            `<p>Click the link below to reset your ${this.appName} password. This link expires in 1 hour.</p>
             <p><a href="${resetLink}" style="background:#4f46e5;color:#fff;padding:10px 20px;text-decoration:none;border-radius:6px;">Reset Password</a></p>
             <p style="font-size:12px;color:#999;">If you didn't request this, ignore this email. Link: ${resetLink}</p>`
        );
    }

    /**
     * Sends a workspace invitation email.
     */
    async sendInvitation(to: string, inviteLink: string) {
        await this.sendEmail(
            [to],
            "You've been invited to join a workspace",
            `<p>You've been invited to join an ${this.appName} workspace.</p>
             <p><a href="${inviteLink}" style="background:#4f46e5;color:#fff;padding:10px 20px;text-decoration:none;border-radius:6px;">Accept Invitation</a></p>
             <p style="font-size:12px;color:#999;">Link expires in 7 days. If the button doesn't work: ${inviteLink}</p>`
        );
    }

    /**
     * Sub-spec D — Sends a shareable agent view link for an inspection
     * report. Used by `POST /api/inspections/:id/share-agent` so the
     * inspector can hand the agent a 30-day signed URL straight from the
     * report viewer.
     */
    async sendAgentShareLink(to: string, address: string, reportUrl: string) {
        await this.sendEmail(
            [to],
            `Inspection report shared: ${address}`,
            `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
               <h1 style="color: #4f46e5;">Inspection Report Shared</h1>
               <p>The inspector has shared the inspection report for <strong>${address}</strong> with you.</p>
               <div style="margin: 32px 0;">
                 <a href="${reportUrl}" style="background: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold;">View Report</a>
               </div>
               <p style="font-size: 14px; color: #666;">If the button doesn't work, copy and paste this link: ${reportUrl}</p>
               <p style="font-size: 12px; color: #999;">This link expires in 30 days.</p>
             </div>`
        );
    }

    /**
     * Sends an inspection report delivery email.
     */
    async sendReportReady(to: string, address: string, reportUrl: string) {
        await this.sendEmail(
            [to],
            `Property Inspection Report: ${address}`,
            `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
               <h1 style="color: #4f46e5;">Report Ready</h1>
               <p>The inspection for <strong>${address}</strong> has been completed and the report is now available.</p>
               <div style="margin: 32px 0;">
                 <a href="${reportUrl}" style="background: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold;">View Interactive Report</a>
               </div>
               <p style="font-size: 14px; color: #666;">If the button doesn't work, copy and paste this link: ${reportUrl}</p>
             </div>`
        );
    }

    /**
     * Sends an inspection report email with the PDF attached.
     * Falls back to caller responsibility if pdfBytes is null/empty —
     * use sendReportReady for the no-attachment variant.
     */
    async sendInspectionReportPdf(
        to: string,
        address: string,
        reportUrl: string,
        pdfBytes: ArrayBuffer,
    ) {
        const safeAddress = address.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
        await this.sendEmail(
            [to],
            `Property Inspection Report: ${address}`,
            `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
                <h1 style="color: #4f46e5;">Your Inspection Report</h1>
                <p>The inspection for <strong>${address}</strong> is complete. The full report is attached as a PDF and also available online.</p>
                <div style="margin: 32px 0;">
                    <a href="${reportUrl}" style="background: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold;">View Interactive Report</a>
                </div>
                <p style="font-size: 14px; color: #666;">PDF attachment: <strong>${safeAddress}-report.pdf</strong></p>
                <p style="font-size: 12px; color: #999;">Online link: ${reportUrl}</p>
            </div>`,
            [{ filename: `${safeAddress}-report.pdf`, content: pdfBytes }],
        );
    }

    /**
     * Sends an agreement signing request email to a client.
     */
    async sendAgreementRequest(to: string, clientName: string | null, agreementName: string, signUrl: string) {
        const name = clientName || 'Client';
        await this.sendEmail(
            [to],
            `Please sign: ${agreementName}`,
            `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px;">
                <h2 style="color: #4f46e5;">Document Ready to Sign</h2>
                <p>Hi ${name},</p>
                <p>You have been asked to review and sign the following agreement:</p>
                <p style="font-weight: bold; color: #1e293b;">${agreementName}</p>
                <div style="margin: 32px 0;">
                    <a href="${signUrl}" style="background: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold;">Review &amp; Sign Agreement</a>
                </div>
                <p style="font-size: 14px; color: #64748b;">If the button doesn't work, copy and paste this link: ${signUrl}</p>
                <p style="color: #64748b; font-size: 14px; margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 10px;">
                    Thank you,<br>${this.appName} Team
                </p>
            </div>`
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
        deps: { db: D1Database; kv?: KVNamespace; baseUrl: string },
    ): Promise<void> {
        if (!this.apiKey) return;
        const throttleKey = `msg_notify:${inspectionId}:${recipient}`;
        if (deps.kv) {
            const recent = await deps.kv.get(throttleKey);
            if (recent) return;
        }

        const { drizzle } = await import('drizzle-orm/d1');
        const { inspections, users } = await import('../lib/db/schema');
        const { eq, and } = await import('drizzle-orm');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = drizzle(deps.db as any);
        const [insp] = await db.select().from(inspections).where(eq(inspections.id, inspectionId)).limit(1);
        if (!insp) return;

        let to: string | null = null;
        let viewUrl = '';
        if (recipient === 'client') {
            to = insp.clientEmail ?? null;
            viewUrl = `${deps.baseUrl}/messages/${insp.messageToken ?? ''}`;
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

        const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const fromName = (message.fromName ?? (recipient === 'client' ? 'your inspector' : (insp.clientName ?? 'your client'))).toString();
        const snippet = message.body.length > 200 ? message.body.slice(0, 197) + '...' : message.body;
        const html = `
            <p>New message from <strong>${escape(fromName)}</strong> regarding <strong>${escape(insp.propertyAddress ?? '')}</strong>:</p>
            <blockquote style="border-left:3px solid #ccc;padding-left:12px;color:#555">${escape(snippet)}</blockquote>
            <p><a href="${viewUrl}">View conversation</a></p>
        `;
        await this.sendEmail([to], `New message — ${insp.propertyAddress ?? 'inspection'}`, html);
        if (deps.kv) await deps.kv.put(throttleKey, '1', { expirationTtl: 300 });
    }

    /**
     * Sprint 1 C-8 — sends a calm, branded confirmation email after a
     * client signs an inspection agreement. CC's the inspector so both
     * parties have a record. All styles inlined per email-client rules
     * (many clients strip <style> blocks).
     *
     * @param to              Client email address (signer)
     * @param ccs             Optional CC list (typically the inspector)
     * @param clientName      Signer name as shown in the agreement
     * @param propertyAddress Property the agreement covers
     * @param verifyUrl       Public verify URL (Spec 5H envelope verifier)
     * @param confirmationId  Short uppercase confirmation code
     * @param signedAtUtc     ISO timestamp of the signature event
     * @param ipAddress       IP recorded with the signature (audit-trail)
     */
    async sendAgreementSignedConfirmation(
        to:               string,
        ccs:              string[],
        clientName:       string,
        propertyAddress:  string,
        verifyUrl:        string,
        confirmationId:   string,
        signedAtUtc:      string,
        ipAddress:        string | null,
    ) {
        const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:24px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;">
          <tr>
            <td style="padding:32px 32px 8px 32px;">
              <h1 style="margin:0 0 8px 0;font-size:18px;font-weight:600;line-height:1.4;color:#0f172a;">Agreement signed</h1>
              <p style="margin:0 0 16px 0;font-size:14px;line-height:1.6;color:#64748b;">
                Thank you, ${escape(clientName)}. Your inspection agreement for
                <strong style="color:#0f172a;">${escape(propertyAddress)}</strong>
                is signed and on file.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 16px 32px;">
              <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:12px 16px;">
                <p style="margin:0;font-size:12px;line-height:1.6;color:#94a3b8;font-family:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;">
                  Signed: ${escape(signedAtUtc)}<br>
                  IP: ${escape(ipAddress || 'recorded')}<br>
                  Confirmation: ${escape(confirmationId)}
                </p>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 32px 32px 32px;">
              <a href="${verifyUrl}" style="display:inline-block;background:#6366f1;color:#ffffff;padding:10px 18px;border-radius:6px;font-size:13px;font-weight:700;text-decoration:none;">View signed agreement</a>
              <p style="margin:16px 0 0 0;font-size:11px;line-height:1.5;color:#94a3b8;">
                If the button does not work, paste this URL into your browser:<br>
                <span style="color:#64748b;word-break:break-all;">${verifyUrl}</span>
              </p>
            </td>
          </tr>
        </table>
        <p style="margin:16px 0 0 0;font-size:11px;color:#94a3b8;">Sent by ${escape(this.appName)}</p>
      </td>
    </tr>
  </table>
</body>
</html>`;

        const recipients = [to, ...ccs.filter(Boolean).filter(e => e && e !== to)];
        await this.sendEmail(
            recipients,
            `Agreement signed — ${propertyAddress}`,
            html,
        );
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

    /**
     * Sends a booking confirmation email.
     *
     * Sprint 1 C-10 — accepts an optional `icsEvent`; when provided,
     * attaches a `.ics` calendar invite that imports cleanly into Apple
     * Calendar / Google Calendar. The body intentionally calls out the
     * attachment so the customer knows to open it.
     */
    async sendBookingConfirmation(
        to: string,
        clientName: string,
        address: string,
        date: string,
        time: string,
        icsEvent?: IcsEvent,
    ) {
        const attachments = icsEvent ? [this.icsAttachment(icsEvent)] : undefined;
        const calendarHint = icsEvent
            ? '<p style="margin: 5px 0; color:#64748b; font-size:13px;">A calendar invite (<strong>inspection.ics</strong>) is attached — open it to add this inspection to your calendar.</p>'
            : '';
        await this.sendEmail(
            [to],
            `Inspection Scheduled: ${address}`,
            `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px;">
                <h2 style="color: #4f46e5;">Inspection Scheduled</h2>
                <p>Hi ${clientName},</p>
                <p>Your property inspection has been successfully scheduled. Here are the details:</p>
                <div style="background: #f8fafc; padding: 15px; border-radius: 8px; margin: 20px 0;">
                    <p style="margin: 5px 0;"><strong>Address:</strong> ${address}</p>
                    <p style="margin: 5px 0;"><strong>Date:</strong> ${date}</p>
                    <p style="margin: 5px 0;"><strong>Time:</strong> ${time}</p>
                </div>
                ${calendarHint}
                <p>Our inspector will arrive during the scheduled window. If you need to reschedule, please contact us.</p>
                <p style="color: #64748b; font-size: 14px; margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 10px;">
                    Thank you,<br>${this.appName} Team
                </p>
            </div>`,
            attachments,
        );
    }
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
    const bytes = new Uint8Array(buf);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}
