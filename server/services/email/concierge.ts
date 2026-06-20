import { escapeHtml, type Constructor } from './base';

/**
 * Agent Accounts A3 — Concierge booking emails. Client-confirm magic-link,
 * inspector-review notice, and the agent-side confirmed / cancelled notices.
 * Mixed into EmailService — see `email.service.ts`.
 */
export function ConciergeEmailMixin<TBase extends Constructor>(Base: TBase) {
    return class ConciergeEmail extends Base {
        /**
         * Sent to the client when a concierge booking enters `awaiting_client`
         * state. The magic-link is a one-shot 7-day-TTL token; clicking it
         * confirms the inspection and (when `agreementRequired`) chains into the
         * standard e-sign flow.
         */
        async sendConciergeClientConfirm(
            to: string,
            params: {
                token: string;
                confirmUrl: string;
                propertyAddress: string;
                date: string;
                inspectorName: string;
            },
        ) {
            const escape = escapeHtml;
            const inspector = escape(params.inspectorName);
            const address = escape(params.propertyAddress);
            const date = escape(params.date);
            const url = params.confirmUrl;
            const fallbackBody = `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#0f172a;">
                <h1 style="font-size:22px;font-weight:700;margin-bottom:8px;">Confirm your inspection</h1>
                <p style="font-size:15px;line-height:1.5;color:#334155;">
                    <strong>${inspector}</strong> has scheduled an inspection for
                    <strong>${address}</strong> on <strong>${date}</strong>.
                </p>
                <p style="font-size:14px;line-height:1.5;color:#334155;">
                    Click below to review the booking and confirm. You'll have the
                    chance to read and sign the inspection agreement on the next page.
                </p>
                <div style="margin:28px 0;">
                    <a href="${url}" style="background:#F55A1A;color:#fff;padding:12px 22px;
                       text-decoration:none;border-radius:8px;font-weight:600;display:inline-block;">
                        Review and Confirm
                    </a>
                </div>
                <p style="font-size:12px;color:#64748b;">
                    This link expires in 7 days. If the button doesn't work, copy and paste:
                    <br>${url}
                </p>
            </div>`;
            const rendered = this.renderOr('concierge-client-confirm', { inspectorName: params.inspectorName, propertyAddress: params.propertyAddress, date: params.date, confirmUrl: params.confirmUrl }, {
                subject: `Confirm your home inspection at ${params.propertyAddress}`,
                html: fallbackBody,
            });
            if (!rendered.enabled) return;
            await this.sendEmail([to], rendered.subject, rendered.html);
        }

        /**
         * Sent to the inspector when a concierge booking enters
         * `awaiting_inspector` state (per-tenant reviewer mode). Tells them an
         * agent submitted a draft and they need to approve it before the client
         * is notified.
         */
        async sendConciergeInspectorReview(
            to: string,
            params: {
                inspectionId: string;
                clientName: string;
                propertyAddress: string;
                date: string;
                reviewUrl: string;
            },
        ) {
            const escape = escapeHtml;
            const client = escape(params.clientName);
            const address = escape(params.propertyAddress);
            const date = escape(params.date);
            const fallbackBody = `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#0f172a;">
                <h1 style="font-size:22px;font-weight:700;margin-bottom:8px;">A booking needs your review</h1>
                <p style="font-size:15px;line-height:1.5;color:#334155;">
                    A partner agent has submitted an inspection booking on behalf of
                    <strong>${client}</strong> for <strong>${address}</strong> on
                    <strong>${date}</strong>.
                </p>
                <p style="font-size:14px;line-height:1.5;color:#334155;">
                    Open your dashboard to approve or cancel. The client will be
                    notified once you approve.
                </p>
                <div style="margin:28px 0;">
                    <a href="${params.reviewUrl}" style="background:#4f46e5;color:#fff;padding:12px 22px;
                       text-decoration:none;border-radius:8px;font-weight:600;display:inline-block;">
                        Open Dashboard
                    </a>
                </div>
            </div>`;
            const rendered = this.renderOr('concierge-inspector-review', { clientName: params.clientName, propertyAddress: params.propertyAddress, date: params.date, reviewUrl: params.reviewUrl }, {
                subject: `Concierge booking awaiting your review: ${params.propertyAddress}`,
                html: fallbackBody,
            });
            if (!rendered.enabled) return;
            await this.sendEmail([to], rendered.subject, rendered.html);
        }

        /**
         * Sent to the agent when their concierge booking is confirmed by the
         * client (state machine final step). Lets the agent close the loop without
         * pinging the inspector.
         */
        async sendConciergeConfirmedToAgent(
            to: string,
            params: { propertyAddress: string; date: string; clientName: string },
        ) {
            const escape = escapeHtml;
            const client = escape(params.clientName);
            const address = escape(params.propertyAddress);
            const date = escape(params.date);
            const fallbackBody = `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#0f172a;">
                <h1 style="font-size:22px;font-weight:700;margin-bottom:8px;">Your client confirmed</h1>
                <p style="font-size:15px;line-height:1.5;color:#334155;">
                    <strong>${client}</strong> has confirmed the inspection for
                    <strong>${address}</strong> on <strong>${date}</strong>.
                </p>
                <p style="font-size:14px;line-height:1.5;color:#334155;">
                    The inspector will reach out directly with day-of details.
                </p>
            </div>`;
            const rendered = this.renderOr('concierge-confirmed-agent', { clientName: params.clientName, propertyAddress: params.propertyAddress, date: params.date }, {
                subject: `Concierge booking confirmed: ${params.propertyAddress}`,
                html: fallbackBody,
            });
            if (!rendered.enabled) return;
            await this.sendEmail([to], rendered.subject, rendered.html);
        }

        /**
         * Sent to the agent if the inspector cancels a concierge booking. Agents
         * can rebook via the same flow once the inspector explains the issue.
         */
        async sendConciergeCancelledToAgent(
            to: string,
            params: { propertyAddress: string; date: string; reason?: string },
        ) {
            const escape = escapeHtml;
            const address = escape(params.propertyAddress);
            const date = escape(params.date);
            const reason = params.reason ? `<p style="font-size:14px;line-height:1.5;color:#334155;">Reason: ${escape(params.reason)}</p>` : '';
            const fallbackBody = `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#0f172a;">
                <h1 style="font-size:22px;font-weight:700;margin-bottom:8px;">A booking was cancelled</h1>
                <p style="font-size:15px;line-height:1.5;color:#334155;">
                    The inspector cancelled the inspection scheduled for
                    <strong>${address}</strong> on <strong>${date}</strong>.
                </p>
                ${reason}
                <p style="font-size:14px;line-height:1.5;color:#334155;">
                    You can submit a new concierge booking from your dashboard.
                </p>
            </div>`;
            const rendered = this.renderOr('concierge-cancelled-agent', { propertyAddress: params.propertyAddress, date: params.date, reason: params.reason ?? '' }, {
                subject: `Concierge booking cancelled: ${params.propertyAddress}`,
                html: fallbackBody,
            });
            if (!rendered.enabled) return;
            await this.sendEmail([to], rendered.subject, rendered.html);
        }
    };
}
