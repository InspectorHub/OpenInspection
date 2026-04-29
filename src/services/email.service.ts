import { AppError, ErrorCode } from '../lib/errors';
import { logger } from '../lib/logger';

/**
 * Service to handle transactional email delivery using Resend.
 * Centralizes all email logic and formatting across the application.
 */
export class EmailService {
    constructor(private apiKey: string, private senderEmail: string, private appName: string) {}

    /**
     * Sends a transactional email.
     */
    async sendEmail(to: string[], subject: string, html: string) {
        if (!this.apiKey || this.apiKey.includes('your_api_key')) {
            logger.warn(`[email] Skipping delivery (API Key missing) to: ${to.join(', ')}`);
            return;
        }

        try {
            const res = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({
                    from: this.senderEmail || `${this.appName} <noreply@example.com>`,
                    to,
                    subject,
                    html
                })
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
     * Sends a booking confirmation email.
     */
    async sendBookingConfirmation(to: string, clientName: string, address: string, date: string, time: string) {
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
                <p>Our inspector will arrive during the scheduled window. If you need to reschedule, please contact us.</p>
                <p style="color: #64748b; font-size: 14px; margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 10px;">
                    Thank you,<br>${this.appName} Team
                </p>
            </div>`
        );
    }
}
