import { drizzle } from 'drizzle-orm/d1';
import { eq, and, lte, sql, desc } from 'drizzle-orm';
import { automations, automationLogs, inspections } from '../lib/db/schema';
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

        await db.insert(automations).values(
            toInsert.map(seed => ({
                id:              nanoid(),
                tenantId,
                name:            seed.name,
                trigger:         seed.trigger,
                recipient:       seed.recipient,
                delayMinutes:    seed.delayMinutes,
                subjectTemplate: seed.subjectTemplate,
                bodyTemplate:    seed.bodyTemplate,
                active:          true,
                isDefault:       true,
                createdAt:       new Date(),
            }))
        );
        logger.info('AutomationService: seeded default rules', { tenantId, count: toInsert.length });
    }

    async list(tenantId: string) {
        const db = this.getDrizzle();
        return db.select().from(automations).where(eq(automations.tenantId, tenantId));
    }

    async create(tenantId: string, data: {
        name: string; trigger: string; recipient: string;
        delayMinutes: number; subjectTemplate: string; bodyTemplate: string;
    }) {
        const db = this.getDrizzle();
        const id = nanoid();
        await db.insert(automations).values({
            id, tenantId, ...data,
            // Casts narrow the public string param to the schema's enum literal
            // union; runtime values are validated by the API zod schema.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            trigger:   data.trigger as any,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            recipient: data.recipient as any,
            active: true, isDefault: false, createdAt: new Date(),
        });
        return (await db.select().from(automations).where(eq(automations.id, id)))[0];
    }

    async update(tenantId: string, id: string, data: Partial<{
        name: string; trigger: string; recipient: string;
        delayMinutes: number; subjectTemplate: string; bodyTemplate: string; active: boolean;
    }>) {
        const db = this.getDrizzle();
        const existing = await db.select().from(automations)
            .where(and(eq(automations.id, id), eq(automations.tenantId, tenantId))).limit(1);
        if (!existing[0]) throw Errors.NotFound('Automation not found');
        // Same enum-narrowing as create() — public Partial<{string}> → table's enum literals.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await db.update(automations).set(data as any)
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
        await this.ensureSeeds(ctx.tenantId);

        const rules = await db.select().from(automations)
            .where(and(
                eq(automations.tenantId, ctx.tenantId),
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                eq(automations.trigger, ctx.triggerEvent as any),
                eq(automations.active, true),
            ));
        if (rules.length === 0) return;

        const inspRows = await db.select().from(inspections)
            .where(and(eq(inspections.id, ctx.inspectionId), eq(inspections.tenantId, ctx.tenantId)))
            .limit(1);
        const insp = inspRows[0];
        if (!insp || insp.disableAutomations) return;

        // Skip rules whose template requires {{agreement_sign_url}} but this
        // inspection didn't opt-in to agreements (agreementRequired = false)
        const filteredRules = rules.filter(rule => {
            if (rule.bodyTemplate.includes('{{agreement_sign_url}}') ||
                rule.subjectTemplate.includes('{{agreement_sign_url}}')) {
                return insp.agreementRequired === true;
            }
            return true;
        });
        if (filteredRules.length === 0) return;

        const now = new Date();
        const logs = filteredRules.flatMap(rule => {
            const email = this.resolveEmail(rule.recipient as string, insp);
            if (!email) return [];
            const sendAt = new Date(now.getTime() + rule.delayMinutes * 60_000).toISOString();
            return [{ id: nanoid(), tenantId: ctx.tenantId, automationId: rule.id,
                      inspectionId: ctx.inspectionId, recipientEmail: email,
                      sendAt, deliveredAt: null, status: 'pending' as const, error: null }];
        });

        if (logs.length > 0) await db.insert(automationLogs).values(logs);
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

    async flush(resendApiKey: string, senderEmail: string, appName: string, appBaseUrl: string, batchSize = 50): Promise<void> {
        const db = this.getDrizzle();
        const now = new Date().toISOString();

        const pending = await db.select({
            log: automationLogs, automation: automations, inspection: inspections,
        })
            .from(automationLogs)
            .innerJoin(automations, eq(automationLogs.automationId, automations.id))
            .innerJoin(inspections, eq(automationLogs.inspectionId, inspections.id))
            .where(and(eq(automationLogs.status, 'pending'), lte(automationLogs.sendAt, now)))
            .limit(batchSize);

        if (pending.length === 0) return;
        logger.info('AutomationService.flush: processing', { count: pending.length });

        for (const { log, automation, inspection } of pending) {
            try {
                const vars: Record<string, string> = {
                    client_name:      inspection.clientName ?? '',
                    property_address: inspection.propertyAddress,
                    scheduled_date:   inspection.date,
                    inspector_name:   '',
                    report_url:       `${appBaseUrl}/report/${inspection.id}`,
                    invoice_url:      `${appBaseUrl}/invoices`,
                    payment_url:      `${appBaseUrl}/invoices`,
                    company_name:     appName,
                    // Spec 4D — event-related vars (populated below if log.eventId set)
                    event_type_name:      '',
                    event_scheduled_at:   '',
                    event_inspector_name: '',
                };

                // Spec 4D — populate event vars when log was created by EventService.
                if (log.eventId) {
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
