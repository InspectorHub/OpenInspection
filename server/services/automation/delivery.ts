import { eq, and, lte, ne, or, isNull, desc } from 'drizzle-orm';
import { automations, automationLogs, inspections, tenants, tenantConfigs, contacts, contactRoleProfiles, inspectionPeople, reportVersions } from '../../lib/db/schema';
import { PRIMARY_CLIENT_KEY } from '../../lib/people/default-role-profiles';
import { wallClockToEpochMs, resolveTenantTimeZone } from '../../lib/tz';
import { logger } from '../../lib/logger';
import type { EmailService } from '../email.service';
import type { Constructor } from './shared';
import type { AutomationBase, HasEvaluateConditions, HasDeliverSms } from './shared';
import type { SmsRuntime } from './sms';
import type { ManagedSendGateEnv } from '../../lib/sms/managed-send-gate';
import type { PlanQuotaGuard } from '../../features/plan-quota/guard';
import { deliverReportEmail, type ReportDeliveryDeps } from './report-email';
import { deliverTemplatedEmail } from './deliver-email';

/**
 * The flush query's SELECT projection. `inspection` is narrowed to the
 * FlushInspection columns (NOT the whole `inspections` row) so the 4-table join
 * stays well under D1's result-set column cap — selecting the full row pushed the
 * total past 100 columns and failed every cron tick (see shared.ts). Exported so
 * the `flush-column-budget` spec can assert the column count.
 *
 * Task 11a — clientContactId/clientName project from the inspection_people
 * primary-client join (contacts.id / contacts.name via the LEFT JOINs added to
 * baseSelect() below), NOT the legacy inspections.client_contact_id/client_name
 * columns (frozen cache, dropped Task 13). The column COUNT is unchanged (still
 * 2 fields under these names) — only the source table moves — so this keeps the
 * `flush-column-budget` spec's total the same.
 */
export const FLUSH_SELECTION = {
    log: automationLogs,
    automation: automations,
    tenant: tenants,
    inspection: {
        id: inspections.id, tenantId: inspections.tenantId,
        clientContactId: contacts.id, clientName: contacts.name,
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
 *
 * Spec 2 Task 2b — `report.published` EMAIL logs additionally branch to
 * report-email.ts:deliverReportEmail (tokenized portal link + PDF) when the
 * optional `reportDelivery` param is supplied; see that param's own doc.
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
            /** Spec 2 Task 2b — opt-in seam: when present, `report.published` EMAIL
             *  logs are delivered as a per-recipient tokenized portal link + PDF
             *  (report-email.ts) instead of the generic template path below. Absent
             *  on every existing caller/test (backward-compatible) and on deploys
             *  missing JWT_SECRET (see scheduled.ts wiring). */
            reportDelivery?: ReportDeliveryDeps,
        ): Promise<void> {
            const db = this.getDrizzle();
            const now = new Date();
            const nowMs = now.getTime();

            // Shared 4-table join so both flush queries (non-reminder fast path +
            // reminder live-due path) select the same shape. `inspection` is a
            // narrowed projection (FLUSH_SELECTION) — selecting the whole inspections
            // row overflows D1's result-set column cap; see FLUSH_SELECTION above.
            // Task 11a — the trailing 3 LEFT JOINs resolve the primary client
            // (contact_role_profiles filtered to 'client' FIRST, then
            // inspection_people, then contacts — same join order as
            // api/metrics.ts / data.service.ts) into FLUSH_SELECTION.inspection's
            // clientContactId/clientName; they add no extra SELECTed columns
            // (FLUSH_SELECTION only projects contacts.id/contacts.name from them),
            // so the column-budget total is unaffected.
            // B1 — LEFT join on automations, not inner. A log's rule is optional:
            // manual sends have written `automation_id IS NULL` since A2 (they
            // survive only because they are inserted already-terminal, so flush
            // never had to see one), and an `in_app` row enqueued outside a rule
            // is the first PENDING one. Under the inner join such a row is not
            // skipped with an error — it is silently absent from the result set,
            // stays pending forever, and nothing anywhere says why. Every
            // `automation.*` read below therefore has an explicit null story.
            const baseSelect = () => db.select(FLUSH_SELECTION)
                .from(automationLogs)
                .leftJoin(automations, eq(automationLogs.automationId, automations.id))
                .innerJoin(inspections, eq(automationLogs.inspectionId, inspections.id))
                .innerJoin(tenants, eq(tenants.id, inspections.tenantId))
                .leftJoin(contactRoleProfiles, and(
                    eq(contactRoleProfiles.tenantId, inspections.tenantId),
                    eq(contactRoleProfiles.key, PRIMARY_CLIENT_KEY),
                    eq(contactRoleProfiles.active, true),
                ))
                .leftJoin(inspectionPeople, and(
                    eq(inspectionPeople.roleProfileId, contactRoleProfiles.id),
                    eq(inspectionPeople.inspectionId, inspections.id),
                    eq(inspectionPeople.tenantId, inspections.tenantId),
                ))
                .leftJoin(contacts, and(
                    eq(contacts.id, inspectionPeople.contactId),
                    eq(contacts.tenantId, inspections.tenantId),
                ));

            // Non-reminder logs: indexed, batch-limited fast path (unchanged semantics —
            // gated on the stored send_at).
            const normal = await baseSelect()
                .where(and(
                    eq(automationLogs.status, 'pending'),
                    lte(automationLogs.sendAt, now),
                    // `ne()` is NULL-blind in SQL — a ruleless row would fail
                    // this predicate and vanish from BOTH batches. It belongs to
                    // the non-reminder one (nothing recomputes its due time), so
                    // say so explicitly.
                    or(
                        isNull(automationLogs.automationId),
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        ne(automations.trigger, 'inspection.reminder' as any),
                    ),
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
            // Resolve each tenant's timezone once so the LIVE due-time uses the same
            // 09:00-local anchor as enqueueReminders (else enqueue/flush disagree).
            const reminderTzByTenant = new Map<string, string>();
            for (const { inspection } of reminderRows) {
                if (!reminderTzByTenant.has(inspection.tenantId)) {
                    const cfg = await db.select({ defaultTimezone: tenantConfigs.defaultTimezone })
                        .from(tenantConfigs).where(eq(tenantConfigs.tenantId, inspection.tenantId)).get();
                    reminderTzByTenant.set(inspection.tenantId, resolveTenantTimeZone(cfg?.defaultTimezone));
                }
            }
            const dueReminders = reminderRows.filter(({ automation, inspection }) => {
                // `automation` is non-null here by construction — the query
                // matched on automations.trigger, which no NULL row can satisfy
                // — but the left join types it nullable, so say it rather than
                // assert it.
                if (!automation) return false;
                const tz = reminderTzByTenant.get(inspection.tenantId) ?? 'UTC';
                const inspMs = wallClockToEpochMs(inspection.date, '09:00', tz);
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

            // Spec 2 Task 2b — render the report PDF ONCE per inspection, reused
            // across every recipient log in this flush() batch (an `all`-recipient
            // report.published rule fans out to N logs for the same inspection).
            // Declared once per flush() call; see report-email.ts:deliverReportEmail.
            const pdfMemo = new Map<string, Promise<ArrayBuffer | null>>();

            // report.amended templates carry the re-publish change note
            // ({{summary}}) from the latest report_versions row. Fetch once per
            // inspection per flush; only amended emails need it, so the query is
            // gated at the call site below (never runs for the common triggers).
            const summaryMemo = new Map<string, Promise<string>>();
            const latestSummary = (inspectionId: string, tenantId: string): Promise<string> => {
                let p = summaryMemo.get(inspectionId);
                if (!p) {
                    p = db.select({ summary: reportVersions.summary })
                        .from(reportVersions)
                        .where(and(eq(reportVersions.tenantId, tenantId), eq(reportVersions.inspectionId, inspectionId)))
                        .orderBy(desc(reportVersions.versionNumber))
                        .limit(1)
                        .get()
                        .then(r => r?.summary ?? '');
                    summaryMemo.set(inspectionId, p);
                }
                return p;
            };

            for (const { log, automation, inspection, tenant } of pending) {
                try {
                    // A ruleless row has no conditions to re-check — there is no
                    // rule to have carried any. Skipping the call is not a
                    // shortcut: passing a null through would make every
                    // condition read defensive for a case that cannot occur.
                    const verdict = automation
                        ? await this.evaluateConditions(db, automation, inspection)
                        : { ok: true as const };
                    if (!verdict.ok) {
                        await db.update(automationLogs).set({ status: 'skipped', error: verdict.reason })
                            .where(eq(automationLogs.id, log.id));
                        continue;
                    }

                    // B1 — `in_app` settles here and goes no further. The notice
                    // HEADER (C1) is what the recipient reads and it was written
                    // at enqueue; their inbox reveals it when `send_at` passes
                    // (§3.14). So there is nothing to dispatch, and this row's
                    // job is to stop saying "Sending" in the Outbox.
                    //
                    // Deliberately BEFORE the quota and consent paths, not
                    // exempted inside them: nothing leaves the building, so
                    // there is no provider to meter and no carrier rule to
                    // satisfy. Charging a plan quota for a row in our own
                    // database would be inventing a cost; running the TCPA gate
                    // over a notice that was never a text message would be
                    // asserting a legal duty that does not apply.
                    if (log.channel === 'in_app') {
                        await db.update(automationLogs)
                            .set({ status: 'sent', deliveredAt: new Date() })
                            .where(eq(automationLogs.id, log.id));
                        continue;
                    }

                    // Track L — branch per the log's own channel. SMS resolves its own
                    // creds + consent in deliverSms; the email path delegates to the
                    // per-tenant EmailService (metering + per-tenant key resolution by construction).
                    if (log.channel === 'sms') {
                        // deliverSms reads the rule for its template and its
                        // consent context. A ruleless SMS row is not a thing any
                        // path creates today — manual SMS logs its own terminal
                        // row — so record the contradiction instead of
                        // inventing a default template for it.
                        if (!automation) {
                            await db.update(automationLogs)
                                .set({ status: 'failed', error: 'sms log has no automation' })
                                .where(eq(automationLogs.id, log.id));
                            continue;
                        }
                        await this.deliverSms(db, { log, automation, inspection, tenant }, sms, appName, appHost, env, quotaGuard);
                        continue;
                    }

                    // Spec 2 Task 2b — report.published EMAIL logs get the tokenized
                    // portal link + PDF attachment when reportDelivery deps are wired
                    // (cron path only — see scheduled.ts). Absent reportDelivery (every
                    // existing test, or a deploy missing JWT_SECRET) falls through
                    // unchanged to the generic template path below. SMS report links
                    // stay generic — out of scope (deliverSms above is untouched).
                    if (log.channel === 'email' && automation?.trigger === 'report.published' && reportDelivery) {
                        const emailSvc = await emailSvcCache.getOrBuild(inspection.tenantId, emailFor);
                        await deliverReportEmail(db, { log, inspection, tenant }, emailSvc, appBaseUrl, reportDelivery, pdfMemo);
                        continue;
                    }

                    // The generic templated-email path lives in deliver-email.ts
                    // (file-size ratchet); it owns every outcome write on that
                    // branch, so there is nothing to interpret here.
                    const emailSvc = await emailSvcCache.getOrBuild(inspection.tenantId, emailFor);
                    await deliverTemplatedEmail(db, { log, automation, inspection, tenant }, {
                        rawDb: this.db,
                        agreementService: this.agreementService,
                        latestSummary,
                        emailSvc,
                        appName, appHost, appBaseUrl,
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
