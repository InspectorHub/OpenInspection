import { type IcsEvent } from '../../lib/ics';
import { type SignatureUser } from '../../lib/inspector-signature';
import { type Constructor } from './base';

/**
 * Inspection-lifecycle email methods: report-ready (link + PDF variants) and
 * the booking confirmation (with optional ICS invite + SMS opt-in). Mixed
 * into EmailService — see `email.service.ts`.
 */
export function InspectionEmailMixin<TBase extends Constructor>(Base: TBase) {
    return class InspectionEmail extends Base {
        /**
         * Sends an inspection report delivery email.
         *
         * Sprint B-4a — appends the inspector's signature when caller passes
         * `inspector` + `host`.
         */
        async sendReportReady(to: string, address: string, reportUrl: string, inspector?: SignatureUser, host?: string) {
            const fallbackBody = `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
               <h1 style="color: #4f46e5;">Report Ready</h1>
               <p>The inspection for <strong>${address}</strong> has been completed and the report is now available.</p>
               <div style="margin: 32px 0;">
                 <a href="${reportUrl}" style="background: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold;">View Interactive Report</a>
               </div>
               <p style="font-size: 14px; color: #666;">If the button doesn't work, copy and paste this link: ${reportUrl}</p>
             </div>`;
            const rendered = this.renderWithSignature(
                'report-ready',
                { address, reportUrl },
                `Property Inspection Report: ${address}`,
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
         * Sends an inspection report email with the PDF attached.
         * Falls back to caller responsibility if pdfBytes is null/empty —
         * use sendReportReady for the no-attachment variant.
         *
         * Sprint B-4a — appends the inspector's signature when caller passes
         * `inspector` + `host`.
         */
        async sendInspectionReportPdf(
            to: string,
            address: string,
            reportUrl: string,
            pdfBytes: ArrayBuffer,
            inspector?: SignatureUser,
            host?: string,
        ) {
            const safeAddress = address.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
            const fallbackBody = `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
                <h1 style="color: #4f46e5;">Your Inspection Report</h1>
                <p>The inspection for <strong>${address}</strong> is complete. The full report is attached as a PDF and also available online.</p>
                <div style="margin: 32px 0;">
                    <a href="${reportUrl}" style="background: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold;">View Interactive Report</a>
                </div>
                <p style="font-size: 14px; color: #666;">PDF attachment: <strong>${safeAddress}-report.pdf</strong></p>
                <p style="font-size: 12px; color: #999;">Online link: ${reportUrl}</p>
            </div>`;
            const rendered = this.renderWithSignature(
                'report-ready-pdf',
                { address, reportUrl },
                `Property Inspection Report: ${address}`,
                fallbackBody,
                inspector,
                host,
            );
            if (!rendered.enabled) return;
            await this.sendEmail(
                [to],
                rendered.subject,
                rendered.html,
                [{ filename: `${safeAddress}-report.pdf`, content: pdfBytes }],
                { inspector },
            );
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
            inspector?: SignatureUser,
            host?: string,
            smsOptinUrl?: string,
        ) {
            const attachments = icsEvent ? [this.icsAttachment(icsEvent)] : undefined;
            const calendarHint = icsEvent
                ? '<p style="margin: 5px 0; color:#64748b; font-size:13px;">A calendar invite (<strong>inspection.ics</strong>) is attached — open it to add this inspection to your calendar.</p>'
                : '';
            const fallbackBody = `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px;">
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
            </div>`;
            const rendered = this.renderWithSignature(
                'booking-confirmation',
                { clientName, address, date, time, icsAttached: !!icsEvent },
                `Inspection Scheduled: ${address}`,
                fallbackBody,
                inspector,
                host,
            );
            if (!rendered.enabled) return;
            // Track L (D6, path B) — append the SMS double-opt-in link. Injected here
            // (renderer level) so it survives template overrides and is never gated on
            // a specific automation rule being enabled.
            const optinBlock = smsOptinUrl
                ? `<p style="margin: 20px 0 0; padding-top: 16px; border-top: 1px solid #e2e8f0; color:#475569; font-size:14px;">
                    Prefer text updates? <a href="${smsOptinUrl}" style="color:#4f46e5; font-weight:600;">Also text me appointment &amp; report updates</a>. Message &amp; data rates may apply; reply STOP to opt out.
               </p>`
                : '';
            await this.sendEmail(
                [to],
                rendered.subject,
                optinBlock ? `${rendered.html}${optinBlock}` : rendered.html,
                attachments,
                { inspector },
            );
        }
    };
}
