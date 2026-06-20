import { eq, and, lte, ne } from 'drizzle-orm';
import { automations, automationLogs, inspections, tenants, tenantConfigs } from '../../lib/db/schema';
import { logger } from '../../lib/logger';
import type { EmailService } from '../email.service';
import { interpolate, type Constructor } from './shared';
import { buildBaseTemplateVars } from './template-vars';
import type { AutomationBase, HasEvaluateConditions, HasDeliverSms } from './shared';

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
            sms?: { resolveCreds: (tenantId: string) => Promise<import('../../lib/sms/resolve-twilio').TwilioCreds | null> } | null,
            batchSize = 50,
        ): Promise<void> {
            const db = this.getDrizzle();
            const now = new Date().toISOString();
            const nowMs = Date.parse(now);

            // Shared 4-table join so both flush queries (non-reminder fast path +
            // reminder live-due path) select the same shape.
            const baseSelect = () => db.select({
                log: automationLogs, automation: automations, inspection: inspections, tenant: tenants,
            })
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
                        await this.deliverSms(db, { log, automation, inspection, tenant }, sms, appName, appHost);
                        continue;
                    }

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
                    const needsAgreementUrl = automation.bodyTemplate.includes('{{agreement_sign_url}}') ||
                                              automation.subjectTemplate.includes('{{agreement_sign_url}}');
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

                    const needsReviewUrl = automation.bodyTemplate.includes('{{review_url}}') ||
                                           automation.subjectTemplate.includes('{{review_url}}');
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

                    const subject = interpolate(automation.subjectTemplate, vars);
                    const html    = interpolate(automation.bodyTemplate, vars);

                    // Route through the per-tenant EmailService so metering and
                    // per-tenant Resend key resolution happen by construction.
                    const emailSvc = await emailSvcCache.getOrBuild(inspection.tenantId, emailFor);
                    const { delivered } = await emailSvc.sendEmail([log.recipient], subject, html);
                    if (delivered) {
                        await db.update(automationLogs).set({ status: 'sent', deliveredAt: new Date().toISOString() })
                            .where(eq(automationLogs.id, log.id));
                    } else {
                        await db.update(automationLogs).set({ status: 'skipped', error: 'email not configured' })
                            .where(eq(automationLogs.id, log.id));
                    }
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
