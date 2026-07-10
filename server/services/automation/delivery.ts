import { eq, and, lte, ne } from 'drizzle-orm';
import { automations, automationLogs, inspections, tenants, tenantConfigs } from '../../lib/db/schema';
import { logger } from '../../lib/logger';
import type { EmailService } from '../email.service';
import { type Constructor, oiClock } from './shared';
import { deliverAction } from '../../lib/automation-core';
import { buildBaseTemplateVars } from './template-vars';
import { createOiTemplateStore } from './template-store';
import type { AutomationBase, HasEvaluateConditions, HasDeliverSms } from './shared';
import type { SmsRuntime } from './sms';
import type { ManagedSendGateEnv } from '../../lib/sms/managed-send-gate';
import type { PlanQuotaGuard } from '../../features/plan-quota/guard';

/**
 * The flush query's SELECT projection. `inspection` is narrowed to the
 * FlushInspection columns (NOT the whole `inspections` row) so the 4-table join
 * stays well under D1's result-set column cap — selecting the full row pushed the
 * total past 100 columns and failed every cron tick (see shared.ts). Exported so
 * the `flush-column-budget` spec can assert the column count.
 */
export const FLUSH_SELECTION = {
    log: automationLogs,
    automation: automations,
    tenant: tenants,
    inspection: {
        id: inspections.id, tenantId: inspections.tenantId,
        clientContactId: inspections.clientContactId, clientName: inspections.clientName,
        propertyAddress: inspections.propertyAddress, date: inspections.date,
        status: inspections.status, reportStatus: inspections.reportStatus,
        paymentStatus: inspections.paymentStatus,
    },
} as const;

/**
 * Delivery mixin: the cron-driven flush() that drains due automation_log rows.
 * Re-checks conditions (conditions mixin), branches SMS to deliverSms (sms mixin),
 * and renders + sends email through the per-tenant EmailService. Body is
 * byte-identical to the former monolith.
 */
export function AutomationDelivery<TBase extends Constructor<AutomationBase & HasEvaluateConditions & HasDeliverSms>>(Base: TBase) {
    return class extends Base {
        async flush(
            emailFor: (tenantId: string) => Promise<EmailService>,
            appName: string, appBaseUrl: string,
            sms?: SmsRuntime,
            batchSize = 50,
            env?: ManagedSendGateEnv,
            /** Free-tier pre-flight (2026-07) — undefined on deployments with no
             *  usage-quota capability (standalone); see scheduled.ts wiring. */
            quotaGuard?: PlanQuotaGuard,
        ): Promise<void> {
            const db = this.getDrizzle();
            const now = new Date().toISOString();
            const nowMs = Date.parse(now);

            // Shared 4-table join so both flush queries (non-reminder fast path +
            // reminder live-due path) select the same shape. `inspection` is a
            // narrowed projection (FLUSH_SELECTION) — selecting the whole inspections
            // row overflows D1's result-set column cap; see FLUSH_SELECTION above.
            const baseSelect = () => db.select(FLUSH_SELECTION)
                .from(automationLogs)
                .innerJoin(automations, eq(automationLogs.automationId, automations.id))
                .innerJoin(inspections, eq(automationLogs.inspectionId, inspections.id))
                .innerJoin(tenants, eq(tenants.id, inspections.tenantId));

            // Non-reminder logs: indexed, batch-limited fast path (unchanged semantics —
            // gated on the stored send_at).
            const normal = await baseSelect()
                .where(and(
                    eq(automationLogs.status, 'pending'),
                    lte(automationLogs.sendAt, now),
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    ne(automations.trigger, 'inspection.reminder' as any),
                ))
                .limit(batchSize);

            // Reminder logs: fetch ALL pending (bounded — enqueueReminders only creates
            // them inside the lead window), then compute the due moment LIVE from the
            // CURRENT inspection.date and keep the due ones. This makes a reschedule
            // "just work" with zero log writes: flush ignores the stored send_at for
            // reminders. Reminders not yet due stay pending and re-evaluate next tick.
            const reminderRows = await baseSelect()
                .where(and(
                    eq(automationLogs.status, 'pending'),
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    eq(automations.trigger, 'inspection.reminder' as any),
                ));
            const dueReminders = reminderRows.filter(({ automation, inspection }) => {
                const inspMs = Date.parse(`${inspection.date}T09:00:00Z`);
                if (Number.isNaN(inspMs)) return false;
                return inspMs - automation.delayMinutes * 60_000 <= nowMs; // derived due-time
            });

            const pending = [...normal, ...dueReminders];

            if (pending.length === 0) return;
            logger.info('AutomationService.flush: processing', { count: pending.length });

            const appHost = (() => {
                try { return new URL(appBaseUrl).host; } catch { return appBaseUrl.replace(/^https?:\/\//, '').replace(/\/$/, ''); }
            })();

            // Memoize EmailService per tenantId so we don't re-load tenant config for
            // every log belonging to the same tenant within a single flush() call.
            const emailSvcCache = (() => {
                const cache = new Map<string, EmailService>();
                return {
                    async getOrBuild(tenantId: string, factory: (tid: string) => Promise<EmailService>): Promise<EmailService> {
                        let svc = cache.get(tenantId);
                        if (!svc) { svc = await factory(tenantId); cache.set(tenantId, svc); }
                        return svc;
                    },
                };
            })();

            for (const { log, automation, inspection, tenant } of pending) {
                try {
                    const verdict = await this.evaluateConditions(db, automation, inspection);
                    if (!verdict.ok) {
                        await db.update(automationLogs).set({ status: 'skipped', error: verdict.reason })
                            .where(eq(automationLogs.id, log.id));
                        continue;
                    }

                    // Track L — branch per the log's own channel. SMS resolves its own
                    // creds + consent in deliverSms; the email path delegates to the
                    // per-tenant EmailService (metering + per-tenant key resolution by construction).
                    if (log.channel === 'sms') {
                        await this.deliverSms(db, { log, automation, inspection, tenant }, sms, appName, appHost, env, quotaGuard);
                        continue;
                    }

                    // SP2 — resolve the referenced email template (replaces the
                    // embedded subject_template / body_template, now frozen DEAD).
                    // Skip fail-closed when the rule has no resolvable email template.
                    const store = createOiTemplateStore(this.db);
                    const tpl = automation.emailTemplateId
                        ? await store.resolve(inspection.tenantId, automation.emailTemplateId)
                        : null;
                    if (!tpl || tpl.channel !== 'email') {
                        await db.update(automationLogs).set({ status: 'skipped', error: 'no email template' })
                            .where(eq(automationLogs.id, log.id));
                        continue;
                    }
                    const subjectSource = tpl.subject ?? '';
                    const bodySource = tpl.body;

                    const vars: Record<string, string> = {
                        ...buildBaseTemplateVars(inspection, tenant, appName, appHost),
                        inspector_name:   '',
                        invoice_url:      `${appBaseUrl}/invoices`,
                        payment_url:      `${appBaseUrl}/invoices`,
                        // Spec 4D — event-related vars (populated below if log.eventId set)
                        event_type_name:      '',
                        event_scheduled_at:   '',
                        event_inspector_name: '',
                    };

                    // Spec 4D — populate event vars when log was created by EventService.
                    // Spec 4D event-vars apply only to logs linked to a real inspection
                    // event. Track J reminders reuse event_id as a "reminder:<rule>:<insp>"
                    // dedup key that never matches an inspectionEvents row, so skip the lookup.
                    if (log.eventId && !log.eventId.startsWith('reminder:')) {
                        try {
                            const { eventTypes, inspectionEvents } = await import('../../lib/db/schema');
                            const ev = await db.select().from(inspectionEvents).where(eq(inspectionEvents.id, log.eventId)).get();
                            if (ev) {
                                const et = await db.select().from(eventTypes).where(eq(eventTypes.id, ev.eventTypeId as string)).get();
                                vars.event_type_name    = (et?.name as string) ?? '';
                                vars.event_scheduled_at = ev.scheduledAt ? new Date(ev.scheduledAt as Date).toLocaleString() : '';
                            }
                        } catch (err) {
                            logger.error('Failed to load event vars for automation log', { logId: log.id, eventId: log.eventId }, err instanceof Error ? err : undefined);
                        }
                    }

                    // Lazy: only create agreement_request when this rule actually needs it
                    const needsAgreementUrl = bodySource.includes('{{agreement_sign_url}}') ||
                                              subjectSource.includes('{{agreement_sign_url}}');
                    if (needsAgreementUrl) {
                        if (!this.agreementService) {
                            await db.update(automationLogs).set({ status: 'failed', error: 'AgreementService not configured' })
                                .where(eq(automationLogs.id, log.id));
                            continue;
                        }
                        try {
                            const ar = await this.agreementService.findOrCreate(inspection.tenantId, inspection.id);
                            vars.agreement_sign_url = `${appBaseUrl}/sign-agreement/${ar.token}`;
                        } catch (e) {
                            const errMsg = e instanceof Error ? e.message : 'Failed to create agreement_request';
                            await db.update(automationLogs).set({ status: 'failed', error: errMsg.slice(0, 500) })
                                .where(eq(automationLogs.id, log.id));
                            continue;
                        }
                    }

                    const needsReviewUrl = bodySource.includes('{{review_url}}') ||
                                           subjectSource.includes('{{review_url}}');
                    if (needsReviewUrl) {
                        const cfg = await db.select({ reviewUrl: tenantConfigs.reviewUrl }).from(tenantConfigs)
                            .where(eq(tenantConfigs.tenantId, inspection.tenantId)).get();
                        if (!cfg?.reviewUrl) {
                            await db.update(automationLogs).set({ status: 'skipped', error: 'review_url not configured' })
                                .where(eq(automationLogs.id, log.id));
                            continue;
                        }
                        vars.review_url = cfg.reviewUrl;
                    }

                    // Build the OI adapters for this log and delegate the
                    // email send + log write to the shared automation core.
                    // SP2: the subject/body come from the referenced message_template
                    // (resolved above into subjectSource/bodySource), so the inline
                    // TemplateStore returns those resolved strings. requiredVars
                    // carries the fail-closed review_url value resolved above
                    // (undefined → core skips with "review_url not configured",
                    //  byte-identical to the former hardcoded guard).
                    const emailSvc = await emailSvcCache.getOrBuild(inspection.tenantId, emailFor);

                    const templateStore = {
                        resolve: async () => ({
                            channel: 'email' as const,
                            subject: subjectSource,
                            body: bodySource,
                            variables: tpl.variables,
                        }),
                    };
                    const transport = {
                        sendEmail: async (a: { to: string; subject: string; html: string }) => {
                            const { delivered } = await emailSvc.sendEmail([a.to], a.subject, a.html);
                            // OI maps "not delivered" (e.g. email not configured) to a
                            // SKIPPED log, not a failure. Encode that as a sentinel the
                            // logger adapter below translates.
                            return delivered
                                ? { ok: true as const }
                                : { ok: false as const, error: '__email_not_configured__' };
                        },
                        sendSms: async () => ({ ok: false as const, error: 'sms not routed here' }),
                    };
                    const loggerAdapter = {
                        record: async (row: { logId: string; status: 'sent' | 'failed' | 'skipped'; error?: string; deliveredAtMs?: number }) => {
                            // Translate the email-not-configured sentinel back to OI's
                            // historical "skipped / email not configured" outcome.
                            if (row.status === 'failed' && row.error === '__email_not_configured__') {
                                await db.update(automationLogs).set({ status: 'skipped', error: 'email not configured' })
                                    .where(eq(automationLogs.id, log.id));
                                return;
                            }
                            if (row.status === 'sent') {
                                await db.update(automationLogs).set({
                                    status: 'sent',
                                    deliveredAt: new Date(row.deliveredAtMs ?? Date.now()).toISOString(),
                                }).where(eq(automationLogs.id, log.id));
                                return;
                            }
                            await db.update(automationLogs).set({ status: row.status, ...(row.error !== undefined ? { error: row.error } : {}) })
                                .where(eq(automationLogs.id, log.id));
                        },
                    };

                    await deliverAction({
                        tenantId: inspection.tenantId,
                        logId: log.id,
                        to: log.recipient,
                        action: { channel: 'email', templateId: automation.id },
                        vars,
                        // Fail-closed vars: review_url was either resolved into `vars`
                        // above or the rule didn't reference it. Pass the resolved value
                        // (or undefined) so the core's requiredVars reproduces the skip.
                        requiredVars: { review_url: vars.review_url },
                        deps: { templates: templateStore, transport, logger: loggerAdapter, clock: oiClock },
                    });
                } catch (err) {
                    await db.update(automationLogs).set({
                        status: 'failed',
                        error:  err instanceof Error ? err.message.slice(0, 500) : 'Unknown error',
                    }).where(eq(automationLogs.id, log.id));
                    logger.error('AutomationService.flush: exception', {}, err instanceof Error ? err : undefined);
                }
            }
        }
    };
}
