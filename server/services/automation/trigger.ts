import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { automations, automationLogs, inspections } from '../../lib/db/schema';
import { nanoid } from 'nanoid';
import { logger } from '../../lib/logger';
import { type Constructor, type TriggerContext } from './shared';
import type { AutomationBase, HasEnsureSeeds, HasParseChannels } from './shared';

/**
 * Trigger mixin: fan out pending automation_log rows when a domain event fires,
 * plus the per-(recipient, channel) address resolver and the notification title
 * helper. `resolveAddress` lives here because both `trigger` and `enqueueReminders`
 * (reminders mixin, later in the chain) call it. Bodies are byte-identical.
 */
export function AutomationTrigger<TBase extends Constructor<AutomationBase & HasEnsureSeeds & HasParseChannels>>(Base: TBase) {
    return class extends Base {
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
            // Track L — fan out one pending log per enabled channel, each stamped with
            // the channel-appropriate recipient (email address or normalized E.164 phone).
            const logs: (typeof automationLogs.$inferInsert)[] = [];
            for (const rule of filteredRules) {
                const channels = this.parseChannels(rule.channels);
                for (const channel of channels) {
                    const addr = await this.resolveAddress(rule.recipient as string, channel, insp, db);
                    if (!addr) {
                        logger.info('AutomationService.trigger: no address resolved for channel (skipping log)',
                            { ruleId: rule.id, recipient: rule.recipient, channel });
                        continue;
                    }
                    const sendAt = new Date(now.getTime() + rule.delayMinutes * 60_000).toISOString();
                    logs.push({ id: nanoid(), tenantId: ctx.tenantId, automationId: rule.id,
                                inspectionId: ctx.inspectionId, recipient: addr, channel,
                                sendAt, deliveredAt: null, status: 'pending' as const, error: null });
                }
            }

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

        /**
         * Track L — resolve the delivery address for a (recipient, channel) pair.
         * email → existing behavior (client only; agents/inspector deferred). sms →
         * E.164 phone for client / selling_agent / buying_agent / inspector. Returns
         * null → the caller skips creating that log (never throws).
         */
        // Public (was `private` on the monolith) so the reminders mixin can call it
        // through a typed cross-mixin contract; no runtime behavior change.
        async resolveAddress(
            recipient: string, channel: 'email' | 'sms',
            insp: typeof inspections.$inferSelect, db: DrizzleD1Database,
        ): Promise<string | null> {
            if (channel === 'email') {
                return recipient === 'client' ? (insp.clientEmail ?? null) : null;
            }
            // channel === 'sms'
            const { contacts, users } = await import('../../lib/db/schema');
            const phoneOf = async (contactId: string | null | undefined) => {
                if (!contactId) return null;
                const c = await db.select({ phone: contacts.phone }).from(contacts)
                    .where(eq(contacts.id, contactId)).get().catch(() => null);
                return c?.phone ?? null;
            };
            let raw: string | null = null;
            if (recipient === 'client') {
                raw = insp.clientPhone ?? (await phoneOf(insp.clientContactId));
            } else if (recipient === 'selling_agent') {
                raw = await phoneOf(insp.sellingAgentId);
            } else if (recipient === 'buying_agent') {
                // referredByAgentId is an unkeyed TEXT (backward-compat); treat it as a
                // contacts.id and resolve a phone if it happens to be one, else null.
                raw = await phoneOf(insp.referredByAgentId);
            } else if (recipient === 'inspector') {
                // Verified against server/lib/db/schema/inspection.ts: the assigned
                // inspector is `inspections.inspector_id` (text FK → users.id, line 46).
                // `lead_inspector_id` (team mode) is the primary when set and falls back
                // to inspector_id per its schema comment, so prefer lead then inspector.
                // (The inspection_inspectors join table from DB-8 is a query face only;
                // inspectorId/leadInspectorId remain canonical for single-value reads.)
                const inspectorId = insp.leadInspectorId ?? insp.inspectorId ?? null;
                if (inspectorId) {
                    const u = await db.select({ phone: users.phone }).from(users)
                        .where(eq(users.id, inspectorId)).get().catch(() => null);
                    raw = u?.phone ?? null;
                }
            }
            const { normalizeE164 } = await import('../../lib/sms/phone');
            return normalizeE164(raw);
        }

        protected titleFor(event: string, insp: typeof inspections.$inferSelect): string {
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
    };
}
