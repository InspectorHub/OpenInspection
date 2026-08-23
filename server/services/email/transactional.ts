import type { SignatureUser } from '../../lib/inspector-signature';
import { escapeHtml, type Constructor } from './base';
import { SUBJECT_RIGHTS_TEMPLATES } from '../../lib/email-templates/subject-rights';

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
            await this.sendRendered(rendered, [to]);
        }

        /**
         * The client portal's magic sign-in link.
         *
         * The route used to build this HTML itself and call `sendEmail`
         * directly, which meant it carried no notification class and could not
         * be tenant-branded, edited or translated — the same three things every
         * other account-access email already had. The caller still owns the
         * link (it mints the token and knows the tenant slug); everything after
         * that is this method's.
         */
        async sendClientPortalLogin(to: string, loginUrl: string) {
            const fallbackBody = `<p>Click the link below to access your inspections. This link expires in 15 minutes.</p>
             <p><a href="${loginUrl}" style="background:#4f46e5;color:#fff;padding:10px 20px;text-decoration:none;border-radius:6px;">Open my portal</a></p>
             <p style="font-size:12px;color:#999;">If you didn't request this, you can safely ignore this email. Link: ${loginUrl}</p>`;
            const rendered = this.renderOr('client-portal-login', { loginUrl }, {
                subject: 'Sign in to your client portal',
                html: fallbackBody,
            });
            if (!rendered.enabled) return;
            await this.sendRendered(rendered, [to]);
        }

        /**
         * The two statutory-rights messages.
         *
         * These do NOT go through `renderOr`, and that is the one deliberate
         * departure from every other method on this surface. Every other
         * outbound message is one the TENANT is making and may rewrite. These
         * report an act performed under statute, and the wording is what makes
         * the report true — an erasure confirmation that dropped the retained
         * categories would still send successfully and would misinform the one
         * person entitled to understand it. So the copy is fixed, in
         * `lib/email-templates/subject-rights.ts`, with substitution points.
         *
         * There is no `enabled` check for the same reason the quota notices have
         * none: both classes are `required`, so nothing can return a disabled
         * result, and guarding anyway would imply a person can switch off being
         * told that their own data was erased.
         */
        async sendSubjectExportReady(
            to: string,
            vars: { requestedAt: string; completedAt: string; downloadUrl: string; expiresAt: string },
        ): Promise<void> {
            await this.sendSubjectRights('subject-export-ready', to, vars);
        }

        async sendSubjectErasureConfirmed(
            to: string,
            vars: { requestedAt: string; completedAt: string; retainedSummary: string },
        ): Promise<void> {
            await this.sendSubjectRights('subject-erasure-confirmed', to, vars);
        }

        /** Shared body: substitute, escape, and send under the class id. */
        async sendSubjectRights(
            classId: 'subject-export-ready' | 'subject-erasure-confirmed',
            to: string,
            vars: Record<string, string>,
        ): Promise<void> {
            const tpl = SUBJECT_RIGHTS_TEMPLATES[classId];
            if (!tpl) throw new Error(`no subject-rights template for ${classId}`);
            // Every substitution is escaped. These bodies carry a URL and a
            // retained-categories summary assembled from manifest text, and a
            // template that is not tenant-editable is still not a reason to
            // interpolate unescaped.
            const filled = Object.entries(vars).reduce(
                (body, [k, v]) => body.split(`{{${k}}}`).join(escapeHtml(v)),
                tpl.body,
            );
            const html = filled
                .split('\n\n')
                .map((para) => `<p>${para.split('\n').join('<br/>')}</p>`)
                .join('');
            await this.sendRendered(
                { trigger: classId, subject: tpl.subject, html, enabled: true },
                [to],
            );
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
            await this.sendRendered(rendered, [to]);
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
            await this.sendRendered(
                rendered,
                [to],
                undefined,
                { inspector },
            );
        }

        /**
         * Free-tier usage quotas (2026-07), Task 8 — threshold notice when a free
         * tenant's lifetime inspection count crosses 4/5 ("one free inspection
         * left") or 5/5 (cap reached; existing inspections stay usable, new ones
         * require a subscription). Recipient is the tenant owner (same
         * `role: 'owner'` lookup used by autoLinkSameEmail in agent/signup.ts).
         *
         * Registry-driven like everything else, but `editable: false` +
         * `brand: 'platform'`: this is OUR message about OUR billing, so a
         * tenant gets the shared layout without the ability to rewrite it. The
         * two thresholds are two templates rather than one with a variable —
         * "one left" and "none left" are different messages, and a recipient
         * reading a list of what we send should see both.
         *
         * Deduplicated via `quota-notice:{tenantId}:{n}` in KV so a retried
         * request — or the benign race of two concurrent creates both reading
         * the lifetime counter at the same threshold — never double-sends.
         *
         * IMPORTANT: the caller MUST assemble this EmailService instance
         * WITHOUT a `meterTenantId` (see `assembleTenantEmailService`) — both
         * `meter` and `quota` are gated on that argument, so an unmetered
         * instance guarantees this send never counts against (or gets blocked
         * by) the tenant's own free-tier email quota.
         */
        async sendQuotaThresholdNotice(
            n: 4 | 5,
            deps: { db: D1Database; kv?: KVNamespace; tenantId: string; billingPortalUrl?: string | null },
        ): Promise<void> {
            const dedupeKey = `quota-notice:${deps.tenantId}:${n}`;
            if (deps.kv && await deps.kv.get(dedupeKey)) return;

            const { drizzle } = await import('drizzle-orm/d1');
            const { users } = await import('../../lib/db/schema');
            const { eq, and, isNull } = await import('drizzle-orm');
            const db = drizzle(deps.db);
            const owner = await db.select({ email: users.email })
                .from(users)
                .where(and(eq(users.tenantId, deps.tenantId), eq(users.role, 'owner'), isNull(users.deletedAt)))
                .get();
            if (!owner?.email) return;

            const appName = escapeHtml(this.appName);
            const cta = deps.billingPortalUrl
                ? `<p><a href="${deps.billingPortalUrl}" style="background:#4f46e5;color:#fff;padding:10px 20px;text-decoration:none;border-radius:6px;">Manage subscription</a></p>`
                : '';
            const trigger = n === 4 ? 'usage-quota-warning' : 'usage-quota-reached';
            const rendered = this.renderOr(trigger, {
                workspaceName: this.appName,
                billingPortalUrl: deps.billingPortalUrl ?? '',
            }, {
                subject: n === 4 ? 'One free inspection left' : "You've used your 5 free inspections",
                html: n === 4
                    ? `<p>Your ${appName} workspace has used 4 of your 5 free inspections. You have one free inspection left.</p>${cta}`
                    : `<p>Your ${appName} workspace has used your 5 free inspections — everything stays usable; subscribe to create new ones.</p>${cta}`,
            });
            // No `enabled` check: both descriptors are `required`, so the
            // renderer cannot return a disabled result. Guarding anyway would
            // imply a tenant can switch off the warning that they are about to
            // lose the ability to create inspections.
            await this.sendRendered(rendered, [owner.email]);

            if (deps.kv) await deps.kv.put(dedupeKey, '1');
        }

        /**
         * A workspace destruction that did not finish, told to the controller.
         *
         * Without undue delay after the failure is KNOWN, not after
         * it is remediated. The purge calls this the moment its incomplete list
         * is final.
         *
         * The BODY is passed in rather than composed here, and that is
         * deliberate: it is a compliance statement, built by the purge from
         * what it actually observed, and re-composing it at the presentation
         * layer would put a second author between the observation and the
         * sentence. The template's only job is to wrap it.
         *
         * `required` in the class registry, so the renderer cannot hand back a
         * disabled result — a workspace must not be able to switch off being
         * told that its own data still exists.
         *
         * The recipient's workspace no longer exists when this sends, so the
         * caller resolves the address before the cascade and passes it. This
         * method makes no owner lookup of its own; there would be nothing left
         * to look up.
         */
        async sendDestructionIncompleteNotice(
            to: string,
            details: { destroyedAt: Date; stores: string[]; body: string },
        ): Promise<void> {
            const rendered = this.renderOr('destruction-incomplete', {
                noticeBody: details.body,
            }, {
                subject: 'Workspace deletion did not complete',
                html: `<p>${escapeHtml(details.body)}</p>`,
            });
            await this.sendRendered(rendered, [to]);
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
            // `clientViewUrl` / `contactEmail` are `?: T | undefined`, not `?: T`.
            // Both callers compute them from something nullable (`thread.email ??
            // undefined`, a deep-link that may have failed to mint), so they pass the
            // key with an undefined value rather than omitting it. That is not a
            // second meaning: below, `contactEmail` is read as
            // `deps.contactEmail ?? client?.email ?? null` and `clientViewUrl` as
            // `deps.clientViewUrl || ${baseUrl}/portal`, so an absent key and an
            // undefined one take the same fallback. Widening here is the honest
            // description; forcing the callers to strip the keys would only hide
            // that they never knew the value.
            deps: { db: D1Database; kv?: KVNamespace; baseUrl: string; clientViewUrl?: string | undefined; contactEmail?: string | undefined },
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
            const { PeopleService } = await import('../people.service');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const db = drizzle(deps.db as any);
            const [insp] = await db.select().from(inspections).where(eq(inspections.id, inspectionId)).limit(1);
            if (!insp) return;

            // Task 9c — the primary client is resolved via inspection_people
            // (PeopleService.getPrimaryClient), NOT the legacy inspections.
            // client_email/client_name columns, which survive GDPR erasure as
            // a stale denormalized cache and were leaking the erased subject's
            // email (recipient) and name (the "from <name>" fallback below).
            const client = await new PeopleService({ DB: deps.db }).getPrimaryClient(insp.tenantId, insp.id);

            let to: string | null = null;
            let viewUrl = '';
            if (recipient === 'client') {
                // Per-contact threading: the caller names the THREAD's contact.
                // Falling back to the primary client keeps legacy callers working.
                to = deps.contactEmail ?? client?.email ?? null;
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
            const fromName = (message.fromName ?? (recipient === 'client' ? 'your inspector' : (client?.name ?? 'your client'))).toString();
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
            await this.sendRendered(rendered, [to]);
            if (deps.kv) await deps.kv.put(throttleKey, '1', { expirationTtl: 300 });
        }

        /**
         * Track D — nudge for a company-inbox message with NO inspection
         * attached (pre-booking outreach). The per-inspection notification
         * above needs an inspection row for its address and deep link; this one
         * deliberately has neither: plain body, no portal link, because the
         * contact-facing surface for a no-inspection thread does not exist yet
         * (Track C3). Without this email the message would be invisible to its
         * recipient entirely.
         */
        async sendContactMessageNotification(
            to: string,
            message: { body: string; fromName?: string | null },
            deps: { kv?: KVNamespace },
        ): Promise<void> {
            if (!this.apiKey || !to) return;
            const throttleKey = `msg_notify:contact:${to}`;
            if (deps.kv) {
                const recent = await deps.kv.get(throttleKey);
                if (recent) return;
            }
            const fromName = (message.fromName ?? 'your inspector').toString();
            const snippet = message.body.length > 200 ? message.body.slice(0, 197) + '...' : message.body;
            const html = `
            <p>New message from <strong>${escapeHtml(fromName)}</strong>:</p>
            <blockquote style="border-left:3px solid #ccc;padding-left:12px;color:#555">${escapeHtml(snippet)}</blockquote>
            <p>Reply to this email to get in touch.</p>
        `;
            const rendered = this.renderOr('message-notification', { fromName, propertyAddress: '', snippet, viewUrl: '' }, {
                subject: `New message from ${fromName}`,
                html,
            });
            if (!rendered.enabled) return;
            await this.sendRendered(rendered, [to]);
            if (deps.kv) await deps.kv.put(throttleKey, '1', { expirationTtl: 300 });
        }
    };
}
