import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { automations, automationLogs, inspections } from '../../lib/db/schema';
import { nanoid } from 'nanoid';
import { logger } from '../../lib/logger';
import { createOiTemplateStore } from './template-store';
import { type Constructor, type TriggerContext } from './shared';
import type { AutomationBase, HasEnsureSeeds, HasParseChannels } from './shared';
import { PRIMARY_CLIENT_KEY } from '../../lib/people/default-role-profiles';
import { PeopleService } from '../people.service';
import { capabilitiesForKind } from '../../lib/people/capabilities';

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

            // Skip rules whose EMAIL template references {{agreement_sign_url}} but
            // this inspection didn't opt-in to agreements (agreementRequired = false).
            // SP2: the message body lives in the referenced message_template now (the
            // embedded subject/body columns are DEAD), so resolve the template and test
            // its content — same gate, content-aware. agreement_sign_url is an email-only
            // var (the SMS path never resolves it), so only the email template matters; a
            // rule with no email template can't reference it.
            const store = createOiTemplateStore(this.db);
            const filteredRules: typeof rules = [];
            for (const rule of rules) {
                let referencesAgreementUrl = false;
                if (rule.emailTemplateId) {
                    const tpl = await store.resolve(ctx.tenantId, rule.emailTemplateId);
                    if (tpl && (tpl.body.includes('{{agreement_sign_url}}') ||
                                (tpl.subject ?? '').includes('{{agreement_sign_url}}'))) {
                        referencesAgreementUrl = true;
                    }
                }
                if (referencesAgreementUrl && insp.agreementRequired !== true) continue;
                filteredRules.push(rule);
            }
            logger.info('AutomationService.trigger: rules after filter',
                { event: ctx.triggerEvent, before: rules.length, after: filteredRules.length });
            if (filteredRules.length === 0) return;

            const now = new Date();
            // Spec 2 Task 3 — report.published is a terminal state → dedup per (rule,
            // inspection, channel, recipient) via a deterministic synthetic eventId, so
            // a retry/double-publish never double-sends (see uq_automation_logs_event).
            // Other events keep eventId NULL: some (e.g. agreement.viewed) legitimately
            // recur and must not be collapsed to once-per-inspection. Computed once per
            // rule/inspection — it doesn't depend on channel/recipient.
            const dedupEventId = ctx.triggerEvent === 'report.published'
                ? `auto:report.published:${ctx.inspectionId}`
                : null;
            // Track L — fan out one pending log per enabled channel, each stamped with
            // the channel-appropriate recipient (email address or normalized E.164 phone).
            const logs: (typeof automationLogs.$inferInsert)[] = [];
            for (const rule of filteredRules) {
                const channels = this.parseChannels(rule.channels);
                for (const channel of channels) {
                    const recipients = await this.resolveRecipients(rule, insp, channel);
                    if (recipients.length === 0) {
                        logger.info('AutomationService.trigger: no recipients resolved for channel (skipping)',
                            { ruleId: rule.id, recipientKind: rule.recipientKind, recipientRoleProfileId: rule.recipientRoleProfileId, channel });
                        continue;
                    }
                    const sendAt = new Date(now.getTime() + rule.delayMinutes * 60_000);
                    for (const r of recipients) {
                        const addr = channel === 'email' ? r.email : r.phone;
                        if (!addr) continue; // resolveRecipients already logged/skipped addr-less people; belt-and-braces
                        logs.push({ id: nanoid(), tenantId: ctx.tenantId, automationId: rule.id,
                                    inspectionId: ctx.inspectionId, recipient: addr, recipientRoleKey: r.roleKey, channel,
                                    sendAt, deliveredAt: null, status: 'pending' as const, error: null, eventId: dedupEventId });
                    }
                }
            }

            logger.info('AutomationService.trigger: logs prepared',
                { event: ctx.triggerEvent, count: logs.length });
            if (logs.length > 0) {
                try {
                    // .onConflictDoNothing() covers the uq_automation_logs_event partial
                    // unique index: a report.published retry produces the SAME
                    // (automationId, inspectionId, eventId, channel, recipient) tuple and
                    // is silently skipped (no duplicate log, no double-send). NULL-eventId
                    // logs (all other triggers) never conflict, so this is a harmless
                    // no-op for them — behavior there is unchanged.
                    await db.insert(automationLogs).values(logs).onConflictDoNothing();
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
         * Resolve the delivery address for a (recipientKind, recipientRoleProfileId,
         * channel) triple. email → 'role' targeting the PRIMARY_CLIENT_KEY profile
         * only (agents/inspector/all deferred — behavior-preserving with the former
         * enum's "email → client only" rule); other role/'inspector'/'all' → null.
         * sms → E.164 phone for ANY role profile key, plus 'inspector'; 'all' → null.
         * An unknown/missing recipientRoleProfileId resolves to null. Returns
         * null → the caller skips creating that log (never throws).
         *
         * Task 11a — role addresses are resolved from `inspection_people` (via
         * `contact_role_profiles`), NOT the legacy inspections.client_email/_phone/
         * _contact_id/selling_agent_id/referred_by_agent_id columns (frozen cache,
         * dropped Task 13). inspector stays on the users table — unrelated to
         * inspection_people.
         *
         * Spec 2 Task 0 — this is a pure discriminator swap (recipientKind/
         * recipientRoleProfileId replace the fixed `recipient` enum); the resolved
         * address per role is unchanged (widening to all `receivesReport` roles is
         * a later task).
         */
        // Public (was `private` on the monolith) so the reminders mixin can call it
        // through a typed cross-mixin contract; no runtime behavior change.
        async resolveAddress(
            recipientKind: 'role' | 'inspector' | 'all', recipientRoleProfileId: string | null, channel: 'email' | 'sms',
            insp: typeof inspections.$inferSelect, db: DrizzleD1Database,
        ): Promise<string | null> {
            const { contacts, users, inspectionPeople, contactRoleProfiles } = await import('../../lib/db/schema');
            // Join order mirrors api/metrics.ts / data.service.ts: contact_role_profiles
            // filtered to (tenant, key, active) FIRST, then inspection_people scoped to
            // this inspection, then contacts — keeps the join to at most one row.
            const contactForRole = async (roleKey: string): Promise<{ email: string | null; phone: string | null } | null> => {
                // Resilience: a transient read failure resolves to "no address" rather
                // than throwing out of resolveAddress and aborting the whole trigger /
                // reminder batch (matches the prior phoneOf `.catch(() => null)` posture).
                // A try/catch (not `.get().catch()`) is used so it works under both the
                // async D1 driver and the synchronous better-sqlite3 test driver.
                try {
                    const row = await db.select({ email: contacts.email, phone: contacts.phone })
                        .from(contactRoleProfiles)
                        .innerJoin(inspectionPeople, and(
                            eq(inspectionPeople.roleProfileId, contactRoleProfiles.id),
                            eq(inspectionPeople.inspectionId, insp.id),
                            eq(inspectionPeople.tenantId, insp.tenantId),
                        ))
                        .innerJoin(contacts, and(
                            eq(contacts.id, inspectionPeople.contactId),
                            eq(contacts.tenantId, insp.tenantId),
                        ))
                        .where(and(
                            eq(contactRoleProfiles.tenantId, insp.tenantId),
                            eq(contactRoleProfiles.key, roleKey),
                            eq(contactRoleProfiles.active, true),
                        )).get();
                    return row ?? null;
                } catch {
                    return null;
                }
            };

            // Resolve the recipient's role-profile id to its stable `key` (the
            // machine id contactForRole joins on — `label` is tenant-editable and
            // not a safe join key). A transient read failure or an unknown/inactive
            // id resolves to null (no throw), same posture as contactForRole.
            const roleKeyFor = async (profileId: string): Promise<string | null> => {
                try {
                    const row = await db.select({ key: contactRoleProfiles.key }).from(contactRoleProfiles)
                        .where(and(eq(contactRoleProfiles.tenantId, insp.tenantId), eq(contactRoleProfiles.id, profileId))).get();
                    return row?.key ?? null;
                } catch {
                    return null;
                }
            };

            if (channel === 'email') {
                if (recipientKind !== 'role' || !recipientRoleProfileId) return null;
                const roleKey = await roleKeyFor(recipientRoleProfileId);
                if (roleKey !== PRIMARY_CLIENT_KEY) return null;
                const c = await contactForRole(PRIMARY_CLIENT_KEY);
                return c?.email ?? null;
            }
            // channel === 'sms'
            let raw: string | null = null;
            if (recipientKind === 'role' && recipientRoleProfileId) {
                const roleKey = await roleKeyFor(recipientRoleProfileId);
                if (roleKey) raw = (await contactForRole(roleKey))?.phone ?? null;
            } else if (recipientKind === 'inspector') {
                // Verified against server/lib/db/schema/inspection.ts: the assigned
                // inspector is `inspections.inspector_id` (text FK → users.id, line 46).
                // `lead_inspector_id` (team mode) is the primary when set and falls back
                // to inspector_id per its schema comment, so prefer lead then inspector.
                // (The inspection_inspectors join table from DB-8 is a query face only;
                // inspectorId/leadInspectorId remain canonical for single-value reads.)
                // Unchanged by Task 11a — inspector is not an inspection_people role.
                const inspectorId = insp.leadInspectorId ?? insp.inspectorId ?? null;
                if (inspectorId) {
                    const u = await db.select({ phone: users.phone }).from(users)
                        .where(eq(users.id, inspectorId)).get().catch(() => null);
                    raw = u?.phone ?? null;
                }
            }
            // recipientKind === 'all' falls through with raw = null (matches the
            // former enum's behavior: 'all' hit no branch and yielded null).
            const { normalizeE164 } = await import('../../lib/sms/phone');
            return normalizeE164(raw);
        }

        /**
         * Spec 2 Task 1 — role-driven recipient resolution: returns EVERY matching
         * recipient (not just the single client address `resolveAddress` targets),
         * so a later task can send one message per recipient. Pure resolver: never
         * throws, never writes `automation_logs` (that stays the flush loop's job
         * — see `trigger()` above, untouched by this method). An addr-less person
         * is logged and skipped, not treated as an error.
         *
         * 'all' = every `receivesReport` person on the inspection's people list —
         * currently client/agent/other all set `receivesReport: true`
         * (`lib/people/capabilities.ts`), so 'all' is effectively "everyone".
         *
         * 'inspector' has no `inspection_people` row — the inspector is a `users`
         * row, not a contact — so it's resolved the same way `resolveAddress`'s
         * inspector branch does (lead falls back to assigned), not via
         * PeopleService. `contactId` on the returned recipient is therefore
         * best-effort: the inspector's user id, not a real `contacts` row id.
         */
        async resolveRecipients(
            rule: { recipientKind: 'role' | 'inspector' | 'all'; recipientRoleProfileId: string | null },
            inspection: typeof inspections.$inferSelect,
            channel: 'email' | 'sms',
        ): Promise<Array<{ contactId: string; roleKey: string; email?: string; phone?: string }>> {
            if (rule.recipientKind === 'inspector') {
                const inspectorId = inspection.leadInspectorId ?? inspection.inspectorId ?? null;
                if (!inspectorId) return [];
                const { users } = await import('../../lib/db/schema');
                const db = this.getDrizzle();
                // Try/catch (not `.get().catch()`) — the latter only behaves as a
                // Promise against the real async D1 driver, not the synchronous
                // better-sqlite3 test driver (same posture as resolveAddress's
                // contactForRole above).
                let u: { email: string | null; phone: string | null } | null;
                try {
                    u = (await db.select({ email: users.email, phone: users.phone }).from(users)
                        .where(eq(users.id, inspectorId)).get()) ?? null;
                } catch {
                    u = null;
                }
                // sms addresses must be normalized to E.164 here — this is the ONLY
                // path that produces automation_logs.recipient for sms (unlike
                // resolveAddress, which normalizes internally); sms.ts sends
                // log.recipient as-is with no send-time re-normalization.
                const { normalizeE164 } = await import('../../lib/sms/phone');
                const addr = channel === 'email' ? (u?.email ?? null) : normalizeE164(u?.phone ?? null);
                if (!addr) return [];
                return [{
                    contactId: inspectorId ?? '',
                    roleKey: 'inspector',
                    ...(channel === 'email' ? { email: addr } : { phone: addr }),
                }];
            }

            const people = await new PeopleService({ DB: this.db }).listPeople(inspection.tenantId, inspection.id);
            const targets = rule.recipientKind === 'role'
                ? people.filter(p => p.roleProfileId === rule.recipientRoleProfileId)
                : people.filter(p => capabilitiesForKind(p.kind).receivesReport);

            const { normalizeE164 } = await import('../../lib/sms/phone');
            const out: Array<{ contactId: string; roleKey: string; email?: string; phone?: string }> = [];
            for (const p of targets) {
                const addr = channel === 'email' ? p.email : normalizeE164(p.phone);
                if (!addr) {
                    logger.info('resolveRecipients: skipping addr-less person', {
                        inspectionId: inspection.id, contactId: p.contactId, roleKey: p.roleKey, channel,
                    });
                    continue;
                }
                out.push({
                    contactId: p.contactId, roleKey: p.roleKey,
                    ...(channel === 'email' ? { email: addr } : { phone: addr }),
                });
            }
            return out;
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
