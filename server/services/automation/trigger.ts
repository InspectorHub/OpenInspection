import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { automations, automationLogs, inspections } from '../../lib/db/schema';
import { nanoid } from 'nanoid';
import { createHeadersForInsertedLogs, type NoticeWording } from './notice-headers';
import { logger } from '../../lib/logger';
import { createOiTemplateStore } from './template-store';
import { resolveRuleRecipients, type ResolvedRecipient } from './recipients';
import { automationClassId } from '../../lib/notifications/automation-classes';
import { getInspectionRoster } from '../../lib/inspection/roster';
import { interpolate } from './shared';
import type { AutomationChannel, RecipientKind, Constructor, TriggerContext } from './shared';
import type { AutomationBase, HasEnsureSeeds, HasParseChannels } from './shared';
import { PRIMARY_CLIENT_KEY } from '../../lib/people/default-role-profiles';
import { m } from '../../lib/i18n/messages';

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
                        // B1 — `in_app` resolves the EMAIL address, and an
                        // address-less recipient is skipped for the same reason
                        // an email one is: every inbox that renders a notice
                        // (client portal, agent portal) authenticates by email,
                        // so a notice nobody can sign in to read is not a
                        // delivery. The address is a label here — the header's
                        // `contact_id` is the identity.
                        const addr = channel === 'sms' ? r.phone : r.email;
                        if (!addr) continue; // resolveRecipients already logged/skipped addr-less people; belt-and-braces
                        // IA-109 — carry the contact id through. The resolver has
                        // it; dropping it forced the SMS consent gate to guess
                        // the person from `inspections.client_contact_id`, which
                        // is only ever right for the primary client.
                        logs.push({ id: nanoid(), tenantId: ctx.tenantId, automationId: rule.id,
                                    inspectionId: ctx.inspectionId, recipient: addr, recipientRoleKey: r.roleKey,
                                    recipientContactId: r.contactId ?? null, channel,
                                    sendAt, deliveredAt: null, status: 'pending' as const, error: null, eventId: dedupEventId });
                    }
                }
            }

            logger.info('AutomationService.trigger: logs prepared',
                { event: ctx.triggerEvent, count: logs.length });
            if (logs.length > 0) {
                let inserted: Array<{ id: string; automationId: string | null; sendAt: Date | number;
                    recipientContactId: string | null; recipientRoleKey: string | null }> = [];
                try {
                    // .onConflictDoNothing() covers the uq_automation_logs_event partial
                    // unique index: a report.published retry produces the SAME
                    // (automationId, inspectionId, eventId, channel, recipient) tuple and
                    // is silently skipped (no duplicate log, no double-send). NULL-eventId
                    // logs (all other triggers) never conflict, so this is a harmless
                    // no-op for them — behavior there is unchanged.
                    inserted = await db.insert(automationLogs).values(logs).onConflictDoNothing()
                        .returning({
                            id: automationLogs.id,
                            automationId: automationLogs.automationId,
                            sendAt: automationLogs.sendAt,
                            recipientContactId: automationLogs.recipientContactId,
                            recipientRoleKey: automationLogs.recipientRoleKey,
                        });
                    logger.info('AutomationService.trigger: logs inserted',
                        { event: ctx.triggerEvent, count: logs.length });
                } catch (err) {
                    logger.error('AutomationService.trigger: log insert failed',
                        { event: ctx.triggerEvent, count: logs.length },
                        err instanceof Error ? err : undefined);
                    throw err;
                }
                // C1 (design §3.13) — one notice HEADER per (rule firing x
                // recipient), each of that recipient's channel rows stamped with
                // it. Only rows that ACTUALLY inserted get headers — a
                // report.published retry conflicts away and must not orphan a
                // fresh header set. Best-effort: the ledger is already durable,
                // and legacy/failed stamps are what the backfill script and the
                // Outbox's interim-key fallback exist for.
                try {
                    // B3 (IA-115) — the wording comes from each rule's in-app
                    // template when it has one. Resolved ONCE per firing rather
                    // than once per header: a rule fanning out to eight staff
                    // would otherwise re-read the same template eight times.
                    const wordingByRule = new Map<string, NoticeWording>();
                    for (const rule of filteredRules) {
                        if (!rule.inAppTemplateId) continue;
                        const tpl = await store.resolve(ctx.tenantId, rule.inAppTemplateId);
                        if (!tpl || tpl.channel !== 'in_app') continue;
                        const vars = {
                            property_address: insp.propertyAddress || 'inspection',
                            company_name: ctx.companyName,
                            scheduled_date: insp.date ?? '',
                        };
                        wordingByRule.set(rule.id, {
                            title: interpolate(tpl.subject ?? '', vars) || this.titleFor(ctx.triggerEvent, insp),
                            body: tpl.body ? interpolate(tpl.body, vars) : null,
                        });
                    }
                    const fallback: NoticeWording = { title: this.titleFor(ctx.triggerEvent, insp), body: null };
                    // The class comes from the RULE, like the wording — two rules
                    // on one event are two different things to have a preference
                    // about, so a per-firing class would be wrong for the same
                    // reason a per-firing title was.
                    const classByRule = new Map<string, string>();
                    for (const rule of filteredRules) {
                        const cls = automationClassId(rule);
                        if (cls) classByRule.set(rule.id, cls);
                    }
                    await createHeadersForInsertedLogs(
                        db, ctx,
                        (automationId) => (automationId && wordingByRule.get(automationId)) || fallback,
                        (automationId) => (automationId ? classByRule.get(automationId) : undefined),
                        inserted,
                    );
                } catch (err) {
                    logger.error('AutomationService.trigger: notice-header creation failed',
                        { event: ctx.triggerEvent },
                        err instanceof Error ? err : undefined);
                }
            }
            // B3 — the blanket "any event with logs also alerts every admin"
            // notification is GONE. It fired outside the engine, so it could not
            // be seen, renamed or switched off, and it double-notified whenever
            // a staff rule already covered the same event. The seeded
            // `Office alert — …` rules (recipientKind 'staff', channel in_app)
            // now do the same job through the same path as every other
            // recipient, which is what makes automations the single config
            // surface rather than one of two.
            //
            // ENQUEUE vs DELIVERY, decided here because B3 is where it starts to
            // matter: the office alert appears at ENQUEUE time, not when flush()
            // settles the row. The header is written above, and the inbox
            // reveals it once `send_at` passes (§3.14) — the cron only moves the
            // Outbox status from "Sending" to "Delivered".
            //
            // The alternative — hold the notice back until the cron marks it
            // sent — was rejected: for a zero-delay rule it would add up to five
            // minutes of latency to an alert whose whole value is immediacy,
            // and it would make the office's view of an event depend on a
            // scheduled job rather than on the event. A DELAYED rule still
            // behaves correctly because the reader-side `send_at` filter, not
            // the delivery status, is what gates visibility.
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
            recipientKind: RecipientKind, recipientRoleProfileId: string | null, channel: AutomationChannel,
            insp: typeof inspections.$inferSelect, db: DrizzleD1Database,
        ): Promise<string | null> {
            // B2 — `staff` is a MULTI-recipient kind and this function answers
            // with one address, so there is no honest answer to give. Only the
            // reminder path still calls it (trigger() moved to
            // resolveRecipients); a staff reminder therefore enqueues nothing
            // rather than picking an arbitrary admin. If staff reminders are
            // ever wanted, reminders.ts moves onto resolveRecipients too — the
            // same change trigger() already made.
            if (recipientKind === 'staff') return null;
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
                // The lead comes from `inspection_inspectors`, which is where
                // assignment lives. This is the same value the old
                // `leadInspectorId ?? inspectorId` expression produced — that is
                // literally how the lead row is resolved when it is written (see
                // buildSyncStatements in lib/db/assignment-links.ts) — so the
                // inspector_id fallback is kept only for inspections created
                // before the link table existed and never re-assigned since.
                // Unchanged by Task 11a — inspector is not an inspection_people role.
                const roster = await getInspectionRoster(db, insp.tenantId, insp.id);
                const inspectorId = roster.lead?.id ?? insp.inspectorId ?? null;
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

        /** See recipients.ts — extracted for the file-size ratchet. */
        async resolveRecipients(
            rule: { recipientKind: RecipientKind; recipientRoleProfileId: string | null },
            inspection: typeof inspections.$inferSelect,
            channel: AutomationChannel,
        ): Promise<ResolvedRecipient[]> {
            return resolveRuleRecipients(this.db, rule, inspection, channel);
        }

        /**
         * The title STORED on a notice when a rule's template has no subject,
         * or resolves to no template at all. Staff/ledger voice with the address
         * — distinct from the recipient-voiced `notice_title_*` family that
         * `app/lib/notice-view.ts` renders for types it recognises, which is why
         * these carry the `comm_` prefix (same split as
         * `comm_reason_sms_opt_out` vs `notice_reason_sms_opt_out`).
         *
         * Reading these through the catalogue does not yet make them render in
         * the RECIPIENT's language — nothing resolves a recipient locale, and in
         * a cron or queue context there is no request locale at all. It makes
         * them reachable by a translator, which they were not before.
         */
        protected titleFor(event: string, insp: typeof inspections.$inferSelect): string {
            const address = insp.propertyAddress || 'inspection';
            switch (event) {
                case 'inspection.created':   return m.comm_notice_title_inspection_created({ address });
                case 'inspection.confirmed': return m.comm_notice_title_inspection_confirmed({ address });
                case 'inspection.cancelled': return m.comm_notice_title_inspection_cancelled({ address });
                case 'report.published':     return m.comm_notice_title_report_published({ address });
                case 'invoice.created':      return m.comm_notice_title_invoice_created({ address });
                case 'payment.received':     return m.comm_notice_title_payment_received({ address });
                // Deliberately kept: a trigger can be added to the enum before a
                // template exists for it, and a readable "<event> — <address>"
                // beats an empty notice title. It is now translatable too.
                default:                     return m.comm_notice_title_generic({ event, address });
            }
        }

    };
}
