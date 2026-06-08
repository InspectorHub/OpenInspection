import { drizzle } from 'drizzle-orm/d1';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { eq, and, lte, gte, sql, desc, notInArray } from 'drizzle-orm';
import { automations, automationLogs, inspections, tenants, agreementRequests, inspectionServices, tenantConfigs } from '../lib/db/schema';
import { reportUrl } from '../lib/public-urls';
import { AUTOMATION_SEEDS } from '../data/automation-seeds';
import { nanoid } from 'nanoid';
import { Errors } from '../lib/errors';
import { logger } from '../lib/logger';
import type { NotificationService } from './notification.service';
import type { AgreementService } from './agreement.service';

function interpolate(template: string, vars: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

interface TriggerContext {
    tenantId:      string;
    inspectionId:  string;
    triggerEvent:  string;
    companyName:   string;
    reportBaseUrl: string;
}

export class AutomationService {
    constructor(private db: D1Database, private notification?: NotificationService, private agreementService?: AgreementService) {}

    private getDrizzle() { return drizzle(this.db); }

    async ensureSeeds(tenantId: string): Promise<void> {
        const db = this.getDrizzle();
        const existing = await db.select().from(automations)
            .where(and(eq(automations.tenantId, tenantId), eq(automations.isDefault, true)));
        if (existing.length >= AUTOMATION_SEEDS.length) return;

        const toInsert = AUTOMATION_SEEDS.filter(
            seed => !existing.some(e => e.name === seed.name && e.trigger === seed.trigger)
        );
        if (toInsert.length === 0) return;

        // D1 caps prepared-statement bind parameters at 100. Each row binds
        // 11 columns, so chunk to 8 rows / 88 binds per insert.
        const CHUNK_SIZE = 8;
        const rows = toInsert.map(seed => ({
            id:              nanoid(),
            tenantId,
            name:            seed.name,
            trigger:         seed.trigger,
            recipient:       seed.recipient,
            delayMinutes:    seed.delayMinutes,
            subjectTemplate: seed.subjectTemplate,
            bodyTemplate:    seed.bodyTemplate,
            active:          (seed as { defaultActive?: boolean }).defaultActive ?? true,
            isDefault:       true,
            createdAt:       new Date(),
        }));
        for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
            await db.insert(automations).values(rows.slice(i, i + CHUNK_SIZE));
        }
        logger.info('AutomationService: seeded default rules', { tenantId, count: toInsert.length });
    }

    async list(tenantId: string) {
        const db = this.getDrizzle();
        return db.select().from(automations).where(eq(automations.tenantId, tenantId));
    }

    async create(tenantId: string, data: {
        name: string; trigger: string; recipient: string;
        delayMinutes: number; subjectTemplate: string; bodyTemplate: string;
        conditions?: { requirePaid?: boolean; requireSigned?: boolean; serviceIds?: string[] } | null;
        channel?: 'email' | 'sms';
    }) {
        const db = this.getDrizzle();
        const id = nanoid();
        const { conditions, channel, ...rest } = data;
        await db.insert(automations).values({
            id, tenantId, ...rest,
            // Casts narrow the public string param to the schema's enum literal
            // union; runtime values are validated by the API zod schema.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            trigger:   rest.trigger as any,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            recipient: rest.recipient as any,
            conditions: conditions ? JSON.stringify(conditions) : null,
            channel:    channel ?? 'email',
            active: true, isDefault: false, createdAt: new Date(),
        });
        return (await db.select().from(automations).where(eq(automations.id, id)))[0];
    }

    async update(tenantId: string, id: string, data: Partial<{
        name: string; trigger: string; recipient: string;
        delayMinutes: number; subjectTemplate: string; bodyTemplate: string; active: boolean;
        conditions: { requirePaid?: boolean; requireSigned?: boolean; serviceIds?: string[] } | null;
        channel: 'email' | 'sms';
    }>) {
        const db = this.getDrizzle();
        const existing = await db.select().from(automations)
            .where(and(eq(automations.id, id), eq(automations.tenantId, tenantId))).limit(1);
        if (!existing[0]) throw Errors.NotFound('Automation not found');
        const { conditions, ...rest } = data;
        const patch: Record<string, unknown> = { ...rest };
        // Key-presence (not truthiness) so an explicit `conditions: null` clears
        // the row while an omitted key leaves it untouched. The zod layer strips
        // absent keys, so `undefined` should not reach here; the guard is belt-
        // and-braces for direct (non-API) callers.
        if ('conditions' in data) patch.conditions = conditions ? JSON.stringify(conditions) : null;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- partial patch → table's typed columns; matches the file's create() cast pattern
        await db.update(automations).set(patch as any)
            .where(and(eq(automations.id, id), eq(automations.tenantId, tenantId)));
        return (await db.select().from(automations).where(eq(automations.id, id)))[0];
    }

    async delete(tenantId: string, id: string): Promise<void> {
        const db = this.getDrizzle();
        const existing = await db.select().from(automations)
            .where(and(eq(automations.id, id), eq(automations.tenantId, tenantId))).limit(1);
        if (!existing[0]) throw Errors.NotFound('Automation not found');
        if (existing[0].isDefault) throw Errors.Forbidden('Cannot delete a default automation rule');
        await db.delete(automations).where(and(eq(automations.id, id), eq(automations.tenantId, tenantId)));
    }

    async trigger(ctx: TriggerContext): Promise<void> {
        const db = this.getDrizzle();
        try {
            await this.ensureSeeds(ctx.tenantId);
        } catch (err) {
            logger.error('AutomationService.trigger: ensureSeeds failed (continuing with existing rules)',
                { event: ctx.triggerEvent, tenantId: ctx.tenantId },
                err instanceof Error ? err : undefined);
        }

        const rules = await db.select().from(automations)
            .where(and(
                eq(automations.tenantId, ctx.tenantId),
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                eq(automations.trigger, ctx.triggerEvent as any),
                eq(automations.active, true),
            ));
        logger.info('AutomationService.trigger: rules matched',
            { event: ctx.triggerEvent, tenantId: ctx.tenantId, count: rules.length });
        if (rules.length === 0) return;

        const inspRows = await db.select().from(inspections)
            .where(and(eq(inspections.id, ctx.inspectionId), eq(inspections.tenantId, ctx.tenantId)))
            .limit(1);
        const insp = inspRows[0];
        if (!insp) {
            logger.error('AutomationService.trigger: inspection not found',
                { event: ctx.triggerEvent, inspectionId: ctx.inspectionId });
            return;
        }
        if (insp.disableAutomations) {
            logger.info('AutomationService.trigger: disableAutomations set, skipping',
                { inspectionId: ctx.inspectionId });
            return;
        }

        // Skip rules whose template requires {{agreement_sign_url}} but this
        // inspection didn't opt-in to agreements (agreementRequired = false)
        const filteredRules = rules.filter(rule => {
            if (rule.bodyTemplate.includes('{{agreement_sign_url}}') ||
                rule.subjectTemplate.includes('{{agreement_sign_url}}')) {
                return insp.agreementRequired === true;
            }
            return true;
        });
        logger.info('AutomationService.trigger: rules after filter',
            { event: ctx.triggerEvent, before: rules.length, after: filteredRules.length });
        if (filteredRules.length === 0) return;

        const now = new Date();
        const logs = filteredRules.flatMap(rule => {
            const email = this.resolveEmail(rule.recipient as string, insp);
            if (!email) {
                logger.info('AutomationService.trigger: no email resolved (will fan out at delivery)',
                    { ruleId: rule.id, recipient: rule.recipient });
                return [];
            }
            const sendAt = new Date(now.getTime() + rule.delayMinutes * 60_000).toISOString();
            return [{ id: nanoid(), tenantId: ctx.tenantId, automationId: rule.id,
                      inspectionId: ctx.inspectionId, recipientEmail: email,
                      sendAt, deliveredAt: null, status: 'pending' as const, error: null }];
        });

        logger.info('AutomationService.trigger: logs prepared',
            { event: ctx.triggerEvent, count: logs.length });
        if (logs.length > 0) {
            try {
                await db.insert(automationLogs).values(logs);
                logger.info('AutomationService.trigger: logs inserted',
                    { event: ctx.triggerEvent, count: logs.length });
            } catch (err) {
                logger.error('AutomationService.trigger: log insert failed',
                    { event: ctx.triggerEvent, count: logs.length },
                    err instanceof Error ? err : undefined);
                throw err;
            }
        }
        if (logs.length > 0 && this.notification) {
            await this.notification.createForAllAdmins(ctx.tenantId, {
                type: ctx.triggerEvent,
                title: this.titleFor(ctx.triggerEvent, insp),
                entityType: 'inspection',
                entityId: ctx.inspectionId,
                metadata: { fromAutomation: true, rules: filteredRules.length },
            });
        }
        logger.info('AutomationService: enqueued', { event: ctx.triggerEvent, count: logs.length });
    }

    private resolveEmail(recipient: string, insp: typeof inspections.$inferSelect): string | null {
        if (recipient === 'client') return insp.clientEmail ?? null;
        return null; // buying_agent/selling_agent/inspector resolved at delivery
    }

    /**
     * Track J (D4) — evaluate a rule's send-time gates against the CURRENT world.
     * Returns a skip reason when a gate fails so flush() can mark the log 'skipped'.
     * channel='sms' is a defensive skip (Track L will implement the sender).
     */
    private async evaluateConditions(
        db: DrizzleD1Database,
        automation: typeof automations.$inferSelect,
        inspection: typeof inspections.$inferSelect,
    ): Promise<{ ok: true } | { ok: false; reason: string }> {
        if (automation.channel === 'sms') return { ok: false, reason: 'channel sms not supported yet' };
        // Track J (D7) — a reminder enqueued for an inspection that has since
        // reached a terminal status (cancelled/completed/delivered/published) is
        // stale; suppress it (e.g. don't send "don't forget tomorrow" for a
        // cancelled inspection). NOTE: a reschedule to a DIFFERENT date is a known
        // v1 limitation — the reminder still fires at the originally-computed time,
        // because we don't currently mutate reminder logs when an inspection's date
        // changes. event_id has no unique index on purpose: Spec 4D reminder+follow-up
        // logs intentionally share an inspection-event id, so the cron's
        // check-then-insert dedup (safe because CF cron runs are effectively serial)
        // is the chosen guard rather than a DB unique constraint.
        if (automation.trigger === 'inspection.reminder' &&
            ['cancelled', 'completed', 'delivered', 'published'].includes(inspection.status)) {
            return { ok: false, reason: 'inspection no longer active' };
        }
        if (!automation.conditions) return { ok: true };

        let cond: { requirePaid?: boolean; requireSigned?: boolean; serviceIds?: string[] };
        try {
            cond = JSON.parse(automation.conditions);
        } catch {
            // Malformed JSON → fail OPEN (treat as no gates) so a corrupt blob
            // doesn't trap the log in 'pending' forever. Warn so the ungated send
            // is observable (conditions are app-serialized, so this implies a bug
            // or manual DB edit). Never log the blob contents.
            logger.warn('AutomationService.evaluateConditions: malformed conditions JSON, sending ungated',
                { automationId: automation.id });
            return { ok: true };
        }

        if (cond.requirePaid && inspection.paymentStatus !== 'paid') {
            return { ok: false, reason: 'condition: not paid' };
        }
        if (cond.requireSigned) {
            const signed = await db.select({ id: agreementRequests.id }).from(agreementRequests)
                .where(and(
                    eq(agreementRequests.tenantId, inspection.tenantId),
                    eq(agreementRequests.inspectionId, inspection.id),
                    eq(agreementRequests.status, 'signed'),
                )).limit(1);
            if (signed.length === 0) return { ok: false, reason: 'condition: agreement not signed' };
        }
        if (cond.serviceIds && cond.serviceIds.length > 0) {
            const rows = await db.select({ serviceId: inspectionServices.serviceId }).from(inspectionServices)
                .where(eq(inspectionServices.inspectionId, inspection.id));
            const have = new Set(rows.map(r => r.serviceId));
            if (!cond.serviceIds.some(id => have.has(id))) {
                return { ok: false, reason: 'condition: service not matched' };
            }
        }
        return { ok: true };
    }

    async flush(resendApiKey: string, senderEmail: string, appName: string, appBaseUrl: string, batchSize = 50): Promise<void> {
        const db = this.getDrizzle();
        const now = new Date().toISOString();

        const pending = await db.select({
            log: automationLogs, automation: automations, inspection: inspections, tenant: tenants,
        })
            .from(automationLogs)
            .innerJoin(automations, eq(automationLogs.automationId, automations.id))
            .innerJoin(inspections, eq(automationLogs.inspectionId, inspections.id))
            .innerJoin(tenants, eq(tenants.id, inspections.tenantId))
            .where(and(eq(automationLogs.status, 'pending'), lte(automationLogs.sendAt, now)))
            .limit(batchSize);

        if (pending.length === 0) return;
        logger.info('AutomationService.flush: processing', { count: pending.length });

        const appHost = (() => {
            try { return new URL(appBaseUrl).host; } catch { return appBaseUrl.replace(/^https?:\/\//, '').replace(/\/$/, ''); }
        })();

        for (const { log, automation, inspection, tenant } of pending) {
            try {
                const verdict = await this.evaluateConditions(db, automation, inspection);
                if (!verdict.ok) {
                    await db.update(automationLogs).set({ status: 'skipped', error: verdict.reason })
                        .where(eq(automationLogs.id, log.id));
                    continue;
                }

                const vars: Record<string, string> = {
                    client_name:      inspection.clientName ?? '',
                    property_address: inspection.propertyAddress,
                    scheduled_date:   inspection.date,
                    inspector_name:   '',
                    report_url:       reportUrl(appHost, tenant.slug, inspection.id),
                    invoice_url:      `${appBaseUrl}/invoices`,
                    payment_url:      `${appBaseUrl}/invoices`,
                    company_name:     appName,
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
                        const { eventTypes, inspectionEvents } = await import('../lib/db/schema');
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
                const from    = senderEmail || `noreply@${appName.toLowerCase().replace(/\s+/g, '')}.com`;

                const res = await fetch('https://api.resend.com/emails', {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ from, to: [log.recipientEmail], subject, html }),
                });

                if (res.ok) {
                    await db.update(automationLogs).set({ status: 'sent', deliveredAt: new Date().toISOString() })
                        .where(eq(automationLogs.id, log.id));
                } else {
                    const errText = await res.text();
                    await db.update(automationLogs).set({ status: 'failed', error: errText.slice(0, 500) })
                        .where(eq(automationLogs.id, log.id));
                    logger.error('AutomationService.flush: Resend error', { logId: log.id, status: res.status });
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

    /**
     * Track J (D7) — appointment reminders. Cron-fired daily. For each active
     * inspection.reminder rule, scan upcoming inspections within the rule's lead
     * window and enqueue a pending automation_log at (inspection date − lead),
     * floored to now+5min. Deduped on eventId = reminder:<ruleId>:<inspectionId>
     * so re-scans don't double-create. The existing flush() sends it when due and
     * re-checks conditions per D4. Reminders are day-granular (inspections.date is
     * date-only); we anchor the appointment at 09:00 UTC.
     */
    async enqueueReminders(nowMs: number): Promise<number> {
        const db = this.getDrizzle();
        const rules = await db.select().from(automations)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .where(and(eq(automations.trigger, 'inspection.reminder' as any), eq(automations.active, true)));
        if (rules.length === 0) return 0;

        const todayStr = new Date(nowMs).toISOString().slice(0, 10);
        let created = 0;

        for (const rule of rules) {
            // Window upper bound = lead + 1.5d buffer so a same-day cron still
            // catches an appointment whose lead window opens within the next day.
            const upperStr = new Date(nowMs + rule.delayMinutes * 60_000 + 36 * 3600_000)
                .toISOString().slice(0, 10);
            const upcoming = await db.select().from(inspections)
                .where(and(
                    eq(inspections.tenantId, rule.tenantId),
                    gte(inspections.date, todayStr),
                    lte(inspections.date, upperStr),
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    notInArray(inspections.status, ['cancelled', 'completed', 'delivered', 'published'] as any),
                ));

            for (const insp of upcoming) {
                if (!insp.clientEmail) continue;
                const eventId = `reminder:${rule.id}:${insp.id}`;
                const dup = await db.select({ id: automationLogs.id }).from(automationLogs)
                    .where(eq(automationLogs.eventId, eventId)).limit(1);
                if (dup.length > 0) continue;

                // tz-naive: 09:00 UTC is an approximate anchor (inspections.date is date-only, no tenant tz here).
                const inspMs = Date.parse(`${insp.date}T09:00:00Z`);
                if (Number.isNaN(inspMs)) continue;
                let sendAt = inspMs - rule.delayMinutes * 60_000;
                if (sendAt < nowMs) sendAt = nowMs + 5 * 60_000;

                await db.insert(automationLogs).values({
                    id: nanoid(), tenantId: rule.tenantId, automationId: rule.id,
                    inspectionId: insp.id, recipientEmail: insp.clientEmail,
                    sendAt: new Date(sendAt).toISOString(), status: 'pending', eventId,
                });
                created++;
            }
        }
        return created;
    }

    async getLogs(tenantId: string, inspectionId: string) {
        const db = this.getDrizzle();
        return db.select().from(automationLogs)
            .where(and(eq(automationLogs.tenantId, tenantId), eq(automationLogs.inspectionId, inspectionId)))
            .orderBy(sql`${automationLogs.sendAt} desc`);
    }

    async listRecentLogs(tenantId: string, limit = 50) {
        const db = this.getDrizzle();
        return await db.select()
            .from(automationLogs)
            .where(eq(automationLogs.tenantId, tenantId))
            .orderBy(desc(automationLogs.sendAt))
            .limit(limit);
    }

    private titleFor(event: string, insp: typeof inspections.$inferSelect): string {
        const addr = insp.propertyAddress || 'inspection';
        switch (event) {
            case 'inspection.created':   return `New inspection scheduled — ${addr}`;
            case 'inspection.confirmed': return `Inspection confirmed — ${addr}`;
            case 'inspection.cancelled': return `Inspection cancelled — ${addr}`;
            case 'report.published':     return `Report published — ${addr}`;
            case 'invoice.created':      return `Invoice created — ${addr}`;
            case 'payment.received':     return `Payment received — ${addr}`;
            default:                     return `${event} — ${addr}`;
        }
    }
}
