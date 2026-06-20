import { logger } from '../../lib/logger';
import { type SignatureUser } from '../../lib/inspector-signature';
import { escapeHtml, type Constructor } from './base';

/**
 * Agent Accounts email methods: partner-agent invite, agent share link,
 * new-referral / report-ready / invoice-paid agent notifications. Mixed
 * into EmailService — see `email.service.ts`.
 */
export function AgentEmailMixin<TBase extends Constructor>(Base: TBase) {
    return class AgentEmail extends Base {
        /**
         * Agent Accounts A1 — sends the partner-agent invite email. Personal hero
         * (inspector + tenant), single CTA, expiry note. Recipient lands on
         * /agent-invite/accept?token=… to set a password.
         */
        async sendAgentInvite(
            to: string,
            params: { token: string; inspectorName: string; tenantName: string; acceptUrl: string },
        ) {
            const escape = escapeHtml;
            const inspector = escape(params.inspectorName);
            const tenant = escape(params.tenantName);
            const url = params.acceptUrl;
            const fallbackBody = `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#0f172a;">
                <h1 style="font-size:22px;font-weight:700;margin-bottom:8px;">You're invited</h1>
                <p style="font-size:15px;line-height:1.5;color:#334155;">
                    <strong>${inspector}</strong> at <strong>${tenant}</strong>
                    has invited you to be a partner agent on ${this.appName}.
                </p>
                <p style="font-size:14px;line-height:1.5;color:#334155;">
                    Accept the invitation to see every inspection your inspectors complete
                    for clients you refer. It's free and takes a minute.
                </p>
                <div style="margin:28px 0;">
                    <a href="${url}" style="background:#4f46e5;color:#fff;padding:12px 22px;
                       text-decoration:none;border-radius:8px;font-weight:600;display:inline-block;">
                        Accept Invitation
                    </a>
                </div>
                <p style="font-size:12px;color:#64748b;">
                    This link expires in 7 days. If the button doesn't work, copy and paste:
                    <br>${url}
                </p>
            </div>`;
            const rendered = this.renderOr('agent-invite', { inspectorName: params.inspectorName, tenantName: params.tenantName, acceptUrl: params.acceptUrl }, {
                subject: `${params.inspectorName} invited you to be a partner agent`,
                html: fallbackBody,
            });
            if (!rendered.enabled) return;
            await this.sendEmail([to], rendered.subject, rendered.html);
        }

        /**
         * Sub-spec D — Sends a shareable agent view link for an inspection
         * report. Used by `POST /api/inspections/:id/share-agent` so the
         * inspector can hand the agent a 30-day signed URL straight from the
         * report viewer.
         *
         * Sprint B-4c — appends the inspector's signature when caller passes
         * `inspector` + `host` so the receiving agent can rebook with the same
         * inspector.
         */
        async sendAgentShareLink(to: string, address: string, reportUrl: string, inspector?: SignatureUser, host?: string) {
            const fallbackBody = `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
               <h1 style="color: #4f46e5;">Inspection Report Shared</h1>
               <p>The inspector has shared the inspection report for <strong>${address}</strong> with you.</p>
               <div style="margin: 32px 0;">
                 <a href="${reportUrl}" style="background: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold;">View Report</a>
               </div>
               <p style="font-size: 14px; color: #666;">If the button doesn't work, copy and paste this link: ${reportUrl}</p>
               <p style="font-size: 12px; color: #999;">This link expires in 30 days.</p>
             </div>`;
            const rendered = this.renderWithSignature(
                'agent-share-link',
                { address, reportUrl },
                `Inspection report shared: ${address}`,
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
         * Agent Accounts A2 — notify a partner agent that a new inspection has
         * been booked under their referral. Gated on `agent.notifyOnReferral`;
         * when the flag is false the call is a silent no-op (logged).
         */
        async sendNewReferral(
            agent: { id: string; email: string; name: string | null; notifyOnReferral: boolean },
            params: { propertyAddress: string; clientName: string | null; dashboardUrl: string },
        ): Promise<void> {
            if (!agent.notifyOnReferral) {
                logger.debug('email.sendNewReferral.skipped', { agentId: agent.id, reason: 'preference_off' });
                return;
            }
            const greet = agent.name ? `Hi ${agent.name},` : 'Hi,';
            const client = params.clientName ? ` for <strong>${params.clientName}</strong>` : '';
            const fallbackBody = `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
            <h1 style="color: #4f46e5;">New referral booked</h1>
            <p>${greet}</p>
            <p>An inspection at <strong>${params.propertyAddress}</strong>${client} has been booked under your referral. We'll let you know again when the report is ready.</p>
            <div style="margin: 32px 0;">
              <a href="${params.dashboardUrl}" style="background: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold;">Open dashboard</a>
            </div>
        </div>`;
            const rendered = this.renderOr('agent-new-referral', { agentName: agent.name ?? '', propertyAddress: params.propertyAddress, clientName: params.clientName ?? '', dashboardUrl: params.dashboardUrl }, {
                subject: `New referral booked: ${params.propertyAddress}`,
                html: fallbackBody,
            });
            if (!rendered.enabled) return;
            await this.sendEmail([agent.email], rendered.subject, rendered.html);
        }

        /**
         * Agent Accounts A2 — agent-recipient variant of sendReportReady. Gated
         * on `agent.notifyOnReport`. Distinct from the inspector-issued
         * `sendReportReady` (client recipient) so the gating logic stays scoped
         * to the agent path.
         */
        async sendAgentReportReady(
            agent: { id: string; email: string; name: string | null; notifyOnReport: boolean },
            params: { propertyAddress: string; reportUrl: string },
        ): Promise<void> {
            if (!agent.notifyOnReport) {
                logger.debug('email.sendAgentReportReady.skipped', { agentId: agent.id, reason: 'preference_off' });
                return;
            }
            const greet = agent.name ? `Hi ${agent.name},` : 'Hi,';
            const fallbackBody = `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
            <h1 style="color: #4f46e5;">Report ready to read</h1>
            <p>${greet}</p>
            <p>The inspection report for <strong>${params.propertyAddress}</strong> has been published. You can read it at the link below.</p>
            <div style="margin: 32px 0;">
              <a href="${params.reportUrl}" style="background: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold;">View report</a>
            </div>
        </div>`;
            const rendered = this.renderOr('agent-report-ready', { agentName: agent.name ?? '', propertyAddress: params.propertyAddress, reportUrl: params.reportUrl }, {
                subject: `Report ready: ${params.propertyAddress}`,
                html: fallbackBody,
            });
            if (!rendered.enabled) return;
            await this.sendEmail([agent.email], rendered.subject, rendered.html);
        }

        /**
         * Agent Accounts A2 — notify a partner agent that an invoice on one of
         * their referrals has been paid. Gated on `agent.notifyOnPaid` (off by
         * default — high-noise signal that most agents won't want).
         */
        async sendInvoicePaid(
            agent: { id: string; email: string; name: string | null; notifyOnPaid: boolean },
            params: { propertyAddress: string; amountCents: number },
        ): Promise<void> {
            if (!agent.notifyOnPaid) {
                logger.debug('email.sendInvoicePaid.skipped', { agentId: agent.id, reason: 'preference_off' });
                return;
            }
            const dollars = (params.amountCents / 100).toFixed(2);
            const greet = agent.name ? `Hi ${agent.name},` : 'Hi,';
            const fallbackBody = `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
            <h1 style="color: #15803d;">Invoice paid</h1>
            <p>${greet}</p>
            <p>The invoice for the inspection at <strong>${params.propertyAddress}</strong> has been paid in full ($${dollars}).</p>
        </div>`;
            const rendered = this.renderOr('agent-invoice-paid', { agentName: agent.name ?? '', propertyAddress: params.propertyAddress, amount: '$' + (params.amountCents/100).toFixed(2) }, {
                subject: `Invoice paid: ${params.propertyAddress}`,
                html: fallbackBody,
            });
            if (!rendered.enabled) return;
            await this.sendEmail([agent.email], rendered.subject, rendered.html);
        }
    };
}
