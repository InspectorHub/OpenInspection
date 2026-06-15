import { drizzle } from 'drizzle-orm/d1';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { eq, and, lte, gte, sql, desc, notInArray, ne, max } from 'drizzle-orm';
import { automations, automationLogs, inspections, tenants, agreementRequests, inspectionServices, tenantConfigs, smsDisclosureVersions } from '../lib/db/schema';
import { reportUrl } from '../lib/public-urls';
import { AUTOMATION_SEEDS } from '../data/automation-seeds';
import { nanoid } from 'nanoid';
import { Errors } from '../lib/errors';
import { logger } from '../lib/logger';
import type { NotificationService } from './notification.service';
import type { AgreementService } from './agreement.service';
import { currentPeriodKey } from '../lib/usage/period';
import type { EmailService } from './email.service';
import { isReportPublished, REPORT_STATUS } from '../lib/status/report-status';

// Track L (D7) — default TCPA SMS opt-in disclosure (version 1). Seeded once by
// ensureSeeds (SaaS) and the standalone raw-SQL path; kept identical in both.
export const SMS_DISCLOSURE_V1 =
    'By providing your phone number and opting in, you agree to receive appointment and report text messages from {{company_name}}. Message and data rates may apply. Reply STOP to opt out, HELP for help.';

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
    constructor(private db: D1Database, private notification?: NotificationService, private agreementService?: AgreementService, private metering?: import('./metering.service').MeteringService) {}

    private getDrizzle() { return drizzle(this.db); }

    async ensureSeeds(tenantId: string): Promise<void> {
        const db = this.getDrizzle();
        // Track L — ensure the global SMS disclosure v1 exists (guarded; idempotent).
        // Tenant-independent: the disclosure ledger is platform-wide, so a max-version
        // check keeps re-runs (and concurrent tenants) from creating a 2nd version.
        await this.ensureSmsDisclosureV1();

        const existing = await db.select().from(automations)
            .where(and(eq(automations.tenantId, tenantId), eq(automations.isDefault, true)));
        if (existing.length >= AUTOMATION_SEEDS.length) return;

        const toInsert = AUTOMATION_SEEDS.filter(
            seed => !existing.some(e => e.name === seed.name && e.trigger === seed.trigger)
        );
        if (toInsert.length === 0) return;

        // D1 caps prepared-statement bind parameters at 100. Each row now binds
        // 13 columns (Track L added channels + sms_body), so chunk to 7 rows /
        // 91 binds per insert (under the 100 cap).
        const CHUNK_SIZE = 7;
        const rows = toInsert.map(seed => ({
            id:              nanoid(),
            tenantId,
            name:            seed.name,
            trigger:         seed.trigger,
            recipient:       seed.recipient,
            delayMinutes:    seed.delayMinutes,
            subjectTemplate: seed.subjectTemplate,
            bodyTemplate:    seed.bodyTemplate,
            channels:        JSON.stringify((seed as { channels?: string[] }).channels ?? ['email']),
            smsBody:         (seed as { smsBody?: string }).smsBody ?? null,
            active:          (seed as { defaultActive?: boolean }).defaultActive ?? true,
            isDefault:       true,
            createdAt:       new Date(),
        }));
        for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
            await db.insert(automations).values(rows.slice(i, i + CHUNK_SIZE));
        }
        logger.info('AutomationService: seeded default rules', { tenantId, count: toInsert.length });
    }

    // Track L (D7) — seed the default TCPA disclosure (version 1) once. Guarded by
    // a max-version check so re-running ensureSeeds never creates a duplicate.
    private async ensureSmsDisclosureV1(): Promise<void> {
        const db = this.getDrizzle();
        const cur = await db.select({ v: max(smsDisclosureVersions.version) })
            .from(smsDisclosureVersions).get();
        if ((cur?.v ?? 0) >= 1) return;
        await db.insert(smsDisclosureVersions).values({
            version:     1,
            text:        SMS_DISCLOSURE_V1,
            publishedAt: new Date(),
        });
    }

    async list(tenantId: string) {
        const db = this.getDrizzle();
        const rows = await db.select().from(automations).where(eq(automations.tenantId, tenantId));
        // Track L (A) — the `channels` column is a JSON STRING at rest, but the API
        // surface (AutomationSchema) types it as string[]. Parse on output so the
        // BFF / typed client see a truthful array.
        return rows.map((r) => this.serializeRow(r));
    }

    /**
     * Track L (A) — project a raw automations row to the API shape, parsing the
     * JSON `channels` column to a `string[]`. Keeps the typed response honest
     * (AutomationSchema.channels is `string[]`) without changing the DB column.
     */
    private serializeRow<T extends { channels: string | null }>(row: T): Omit<T, 'channels'> & { channels: ('email' | 'sms')[] } {
        const { channels, ...rest } = row;
        return { ...rest, channels: this.parseChannels(channels) };
    }

    async create(tenantId: string, data: {
        name: string; trigger: string; recipient: string;
        delayMinutes: number; subjectTemplate: string; bodyTemplate: string;
        conditions?: { requirePaid?: boolean; requireSigned?: boolean; serviceIds?: string[] } | null;
        channels?: ('email' | 'sms')[]; smsBody?: string | null;
    }) {
        const db = this.getDrizzle();
        const id = nanoid();
        const { conditions, channels, smsBody, ...rest } = data;
        await db.insert(automations).values({
            id, tenantId, ...rest,
            // Casts narrow the public string param to the schema's enum literal
            // union; runtime values are validated by the API zod schema.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            trigger:   rest.trigger as any,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            recipient: rest.recipient as any,
            conditions: conditions ? JSON.stringify(conditions) : null,
            // Track L — channels is the live field; the dead `channel` column is left
            // to its DB default ('email') so its NOT NULL constraint stays satisfied.
            channels: JSON.stringify(channels?.length ? channels : ['email']),
            smsBody:  smsBody ?? null,
            active: true, isDefault: false, createdAt: new Date(),
        });
        // Track L (A) — parse channels on output to match the typed API shape.
        return this.serializeRow((await db.select().from(automations).where(eq(automations.id, id)))[0]);
    }

    async update(tenantId: string, id: string, data: Partial<{
        name: string; trigger: string; recipient: string;
        delayMinutes: number; subjectTemplate: string; bodyTemplate: string; active: boolean;
        conditions: { requirePaid?: boolean; requireSigned?: boolean; serviceIds?: string[] } | null;
        channels: ('email' | 'sms')[]; smsBody: string | null;
    }>) {
        const db = this.getDrizzle();
        const existing = await db.select().from(automations)
            .where(and(eq(automations.id, id), eq(automations.tenantId, tenantId))).limit(1);
        if (!existing[0]) throw Errors.NotFound('Automation not found');
        const { conditions, channels, smsBody, ...rest } = data;
        const patch: Record<string, unknown> = { ...rest };
        // Key-presence (not truthiness) so an explicit `conditions: null` clears
        // the row while an omitted key leaves it untouched. The zod layer strips
        // absent keys, so `undefined` should not reach here; the guard is belt-
        // and-braces for direct (non-API) callers.
        if ('conditions' in data) patch.conditions = conditions ? JSON.stringify(conditions) : null;
        // Track L — channels/sms_body persist on the same key-presence contract.
        if ('channels' in data) patch.channels = JSON.stringify(channels?.length ? channels : ['email']);
        if ('smsBody' in data) patch.smsBody = smsBody ?? null;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- partial patch → table's typed columns; matches the file's create() cast pattern
        await db.update(automations).set(patch as any)
            .where(and(eq(automations.id, id), eq(automations.tenantId, tenantId)));
        // Track L (A) — parse channels on output to match the typed API shape.
        return this.serializeRow((await db.select().from(automations).where(eq(automations.id, id)))[0]);
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
    private async resolveAddress(
        recipient: string, channel: 'email' | 'sms',
        insp: typeof inspections.$inferSelect, db: DrizzleD1Database,
    ): Promise<string | null> {
        if (channel === 'email') {
            return recipient === 'client' ? (insp.clientEmail ?? null) : null;
        }
        // channel === 'sms'
        const { contacts, users } = await import('../lib/db/schema');
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
        const { normalizeE164 } = await import('../lib/sms/phone');
        return normalizeE164(raw);
    }

    /**
     * Track L — parse the JSON `channels` column into a validated channel list.
     * Defends against malformed/empty JSON (or a NULL legacy row) by falling back
     * to email-only, so a corrupt blob never traps a rule from firing.
     */
    private parseChannels(raw: string | null): ('email' | 'sms')[] {
        if (!raw) return ['email'];
        try {
            const arr = JSON.parse(raw);
            const valid = Array.isArray(arr) ? arr.filter((c) => c === 'email' || c === 'sms') : [];
            return valid.length ? valid : ['email'];
        } catch { return ['email']; }
    }

    /**
     * Track J (D4) — evaluate a rule's send-time gates against the CURRENT world.
     * Returns a skip reason when a gate fails so flush() can mark the log 'skipped'.
     * Track L — SMS gating (consent/credentials) now lives per-channel in flush(),
     * NOT here; this evaluates channel-agnostic conditions only.
     */
    private async evaluateConditions(
        db: DrizzleD1Database,
        automation: typeof automations.$inferSelect,
        inspection: typeof inspections.$inferSelect,
    ): Promise<{ ok: true } | { ok: false; reason: string }> {
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
            (inspection.status === 'cancelled' || inspection.status === 'completed' ||
             isReportPublished(inspection.reportStatus))) {
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

    async flush(
        emailFor: (tenantId: string) => Promise<EmailService>,
        appName: string, appBaseUrl: string,
        sms?: { resolveCreds: (tenantId: string) => Promise<import('../lib/sms/resolve-twilio').TwilioCreds | null> } | null,
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

    /**
     * Track L — deliver one SMS automation log via Twilio. Client logs are gated
     * on a recorded 'granted' consent event (agents/inspector are implied; D5);
     * creds resolve through the injected sms.resolveCreds (per-tenant platform/own).
     * Renders the rule's plain-text smsBody with the var map, fail-closed on an
     * unconfigured review_url. Maps Twilio ok→sent / !ok→failed; every guard skips
     * the log with a reason. Never throws (caller's try/catch marks failed otherwise).
     */
    private async deliverSms(
        db: DrizzleD1Database,
        ctx: { log: typeof automationLogs.$inferSelect; automation: typeof automations.$inferSelect;
               inspection: typeof inspections.$inferSelect; tenant: typeof tenants.$inferSelect },
        sms: { resolveCreds: (tenantId: string) => Promise<import('../lib/sms/resolve-twilio').TwilioCreds | null> } | null | undefined,
        appName: string, appHost: string,
    ): Promise<void> {
        const { log, automation, inspection, tenant } = ctx;
        const skip = (reason: string) =>
            db.update(automationLogs).set({ status: 'skipped', error: reason }).where(eq(automationLogs.id, log.id));

        if (!automation.smsBody?.trim()) return void (await skip('no sms body'));
        if (!sms) return void (await skip('sms not configured'));

        // Consent gate — client only (agents/inspector implied; D5).
        if (automation.recipient === 'client') {
            const { SmsConsentService } = await import('./sms-consent.service');
            const consentSvc = new SmsConsentService(this.db);
            const contactId = inspection.clientContactId;
            const latest = contactId ? await consentSvc.getLatest(inspection.tenantId, contactId) : null;
            if (latest !== 'granted') return void (await skip('no sms consent'));
        }

        const creds = await sms.resolveCreds(inspection.tenantId);
        if (!creds) return void (await skip('sms not configured'));

        // Load the tenant config row once for the SMS vars: company_phone is used
        // unconditionally by the seeded copy ("questions? call {{company_phone}}"),
        // and review_url is the fail-closed consumer below.
        const cfg = await db.select({ companyPhone: tenantConfigs.companyPhone, reviewUrl: tenantConfigs.reviewUrl })
            .from(tenantConfigs).where(eq(tenantConfigs.tenantId, inspection.tenantId)).get();

        const vars: Record<string, string> = {
            client_name:      inspection.clientName ?? '',
            property_address: inspection.propertyAddress,
            scheduled_date:   inspection.date,
            report_url:       reportUrl(appHost, tenant.slug, inspection.id),
            company_name:     appName,
            company_phone:    cfg?.companyPhone ?? '',
        };
        // review_url fail-closed (same rule as the email path).
        if (automation.smsBody.includes('{{review_url}}')) {
            if (!cfg?.reviewUrl) return void (await skip('review_url not configured'));
            vars.review_url = cfg.reviewUrl;
        }
        const body = interpolate(automation.smsBody, vars);

        const { sendTwilioSms } = await import('../lib/sms/send-sms');
        const res = await sendTwilioSms(creds, log.recipient, body);
        if (res.ok) {
            await db.update(automationLogs).set({ status: 'sent', deliveredAt: new Date().toISOString() })
                .where(eq(automationLogs.id, log.id));
            try {
                await this.metering?.record(tenant.id, 'sms', currentPeriodKey(new Date()));
            } catch { /* metering must never break delivery */ }
        } else {
            await db.update(automationLogs).set({ status: 'failed', error: res.error })
                .where(eq(automationLogs.id, log.id));
            logger.error('AutomationService.flush: twilio send failed', { logId: log.id });
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
                    notInArray(inspections.status, ['cancelled', 'completed'] as any),
                    ne(inspections.reportStatus, REPORT_STATUS.PUBLISHED),
                ));

            for (const insp of upcoming) {
                // Track L — fan out one reminder log per enabled channel. Per-channel
                // address resolution replaces the old single clientEmail guard.
                const channels = this.parseChannels(rule.channels);
                for (const channel of channels) {
                    const addr = await this.resolveAddress(rule.recipient as string, channel, insp, db);
                    if (!addr) continue;
                    // Dedup key is per-channel so email + sms reminders for the same
                    // (rule, inspection) coexist and each de-dupes independently.
                    const eventId = `reminder:${rule.id}:${insp.id}:${channel}`;
                    const dup = await db.select({ id: automationLogs.id }).from(automationLogs)
                        .where(eq(automationLogs.eventId, eventId)).limit(1);
                    if (dup.length > 0) continue;

                    // tz-naive: 09:00 UTC is an approximate anchor (inspections.date is date-only, no tenant tz here).
                    const inspMs = Date.parse(`${insp.date}T09:00:00Z`);
                    if (Number.isNaN(inspMs)) continue;
                    // send_at here is a DISPLAY ESTIMATE only — flush() derives the real
                    // reminder due-time live from the current inspection.date (Task 7),
                    // so a reschedule (a `date` write on the inspection) needs no update
                    // to this row. We still write the estimate: the column is NOT NULL
                    // and it is a useful default for display/sort.
                    let sendAt = inspMs - rule.delayMinutes * 60_000;
                    if (sendAt < nowMs) sendAt = nowMs + 5 * 60_000;

                    await db.insert(automationLogs).values({
                        id: nanoid(), tenantId: rule.tenantId, automationId: rule.id,
                        inspectionId: insp.id, recipient: addr, channel,
                        // send_at is a display estimate; flush() derives the real due-time live from inspection.date
                        sendAt: new Date(sendAt).toISOString(), status: 'pending', eventId,
                    });
                    created++;
                }
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
