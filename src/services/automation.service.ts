import { drizzle } from 'drizzle-orm/d1';
import { eq, and, lte, sql } from 'drizzle-orm';
import { automations, automationLogs, inspections } from '../lib/db/schema';
import { AUTOMATION_SEEDS } from '../data/automation-seeds';
import { nanoid } from 'nanoid';
import { Errors } from '../lib/errors';
import { logger } from '../lib/logger';

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
    constructor(private db: D1Database) {}

    private getDrizzle() { return drizzle(this.db as any); }

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
            trigger:   data.trigger as any,
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
                eq(automations.trigger, ctx.triggerEvent as any),
                eq(automations.active, true),
            ));
        if (rules.length === 0) return;

        const inspRows = await db.select().from(inspections)
            .where(and(eq(inspections.id, ctx.inspectionId), eq(inspections.tenantId, ctx.tenantId)))
            .limit(1);
        const insp = inspRows[0];
        if (!insp || insp.disableAutomations) return;

        const now = new Date();
        const logs = rules.flatMap(rule => {
            const email = this.resolveEmail(rule.recipient as string, insp);
            if (!email) return [];
            const sendAt = new Date(now.getTime() + rule.delayMinutes * 60_000).toISOString();
            return [{ id: nanoid(), tenantId: ctx.tenantId, automationId: rule.id,
                      inspectionId: ctx.inspectionId, recipientEmail: email,
                      sendAt, deliveredAt: null, status: 'pending' as const, error: null }];
        });

        if (logs.length > 0) await db.insert(automationLogs).values(logs);
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
                    sign_url:         `${appBaseUrl}/sign/${inspection.id}`,
                    invoice_url:      `${appBaseUrl}/invoices`,
                    payment_url:      `${appBaseUrl}/invoices`,
                    company_name:     appName,
                };

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
}
