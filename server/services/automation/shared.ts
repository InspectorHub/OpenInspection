import { drizzle } from 'drizzle-orm/d1';
import type { Clock } from '../../lib/automation-core';

/**
 * Shared base + module-level helpers for the AutomationService mixin chain.
 *
 * The former monolithic `automation.service.ts` (~744 LOC) is split into focused
 * mixins (core / trigger / conditions / delivery / sms / reminders / logs). Each
 * mixin extends the previous one so EVERY method stays on a single `this`, and
 * the original method bodies move byte-identically (no delegation rewrites). The
 * only visibility change is `private` → `protected` so a method in one mixin can
 * read the deps / call the helpers another mixin defined — this is a TypeScript-
 * only widening with zero runtime effect, and the public surface is unchanged.
 *
 * The composed class is exported as `AutomationService` from
 * `../automation.service.ts`, so all call sites / tests / the cron caller keep
 * importing it from the same module.
 */

// Track L (D7) — default TCPA SMS opt-in disclosure (version 1). Seeded once by
// ensureSeeds (SaaS) and the standalone raw-SQL path; kept identical in both.
export const SMS_DISCLOSURE_V1 =
    'By providing your phone number and opting in, you agree to receive appointment and report text messages from {{company_name}}. Message frequency varies by your inspection activity. Message and data rates may apply. Reply STOP to opt out, HELP for help.';

export function interpolate(template: string, vars: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

export interface TriggerContext {
    tenantId:      string;
    inspectionId:  string;
    triggerEvent:  string;
    companyName:   string;
    reportBaseUrl: string;
    /**
     * Which DELIVERABLE a report event is about. One order can publish a
     * standard report on Tuesday and a radon report on Thursday, and the
     * `report.published` dedup key has to tell those apart — keyed on the
     * inspection alone, the second publish is silently swallowed as a retry of
     * the first. Absent for every non-report trigger.
     */
    reportId?:     string;
    /**
     * The `inspection_events` row this firing is about, when there is one.
     *
     * Two things depend on it and neither has another source: the delivered
     * copy names the event type ({{event_type_name}}, resolved from the log's
     * `event_id` in deliver-email.ts), and a retried status transition conflicts
     * on `uq_automation_logs_event` instead of notifying the client twice —
     * which holds only because these logs also carry an automation_id (see that
     * index's comment). Absent for every trigger that is not about one visit.
     */
    eventId?:      string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Constructor<T = object> = new (...args: any[]) => T;

// --- Cross-mixin method contracts -------------------------------------------
// TypeScript mixins only expose the constructor constraint's type, not methods a
// later mixin inherits at runtime. So a mixin that calls a method defined by an
// EARLIER mixin must constrain its base to also satisfy that method's contract.
// These interfaces are the minimal shapes needed for those cross-mixin calls;
// they impose no runtime cost (type-layer only).

import type { DrizzleD1Database } from 'drizzle-orm/d1';
import type { automations, automationLogs, inspections } from '../../lib/db/schema';

// The inspection columns the cron flush path actually consumes (condition
// evaluation + SMS consent + base template vars). The flush query MUST project
// only these instead of the whole `inspections` row: the 4-table join
// (automation_logs + automations + inspections + tenants) otherwise produced
// 100+ result columns and tripped D1's result-set column cap ("too many columns
// in result set", SQLITE_ERROR 7500), failing EVERY cron tick once `inspections`
// grew past ~70 columns. `delivery.ts` FLUSH_SELECTION.inspection projects
// exactly these columns; because flush() feeds that row into consumers typed as
// FlushInspection, type-check enforces the projection stays a superset of this
// type, and the `flush-column-budget` spec guards the total under the cap.
//
// Task 11a — clientContactId/clientName are NO LONGER `inspections` columns
// here. They're resolved via the inspection_people primary-client join
// (FLUSH_SELECTION in delivery.ts LEFT JOINs contact_role_profiles →
// inspection_people → contacts, projecting contacts.id/contacts.name under
// these same field names), replacing the legacy inspections.client_contact_id
// / client_name reads (frozen cache, dropped Task 13). sms.ts's consent-gate
// read and template-vars.ts's client_name interpolation are both unchanged —
// they just consume whichever value this type carries.
export type FlushInspection = Pick<typeof inspections.$inferSelect,
    | 'id' | 'tenantId' | 'propertyAddress' | 'date' | 'status' | 'reportStatus' | 'paymentStatus'
> & {
    clientContactId: string | null;
    clientName: string | null;
};

/**
 * The channels a rule can fan out to, derived from the column's own enum so
 * widening the schema propagates instead of being remembered. `in_app` (B1)
 * delivers nothing outward — the notice header IS the delivery — but it is a
 * first-class channel everywhere the ledger is concerned.
 */
export type AutomationChannel = typeof automationLogs.$inferSelect['channel'];
export const AUTOMATION_CHANNELS: readonly AutomationChannel[] = ['email', 'sms', 'in_app'];

/**
 * The role key stamped on a log whose recipient is the workspace's admin
 * staff (B2). Distinct from 'inspector', which names one particular user.
 */
export const STAFF_ROLE_KEY = 'staff';

/** Derived from the column so widening the schema propagates. */
export type RecipientKind = typeof automations.$inferSelect['recipientKind'];

/**
 * True when a log's `recipient_role_key` names a `users` row rather than a
 * `contacts` row.
 *
 * This is the discriminator C1's header writer needs: `notifications` asserts
 * user_id XOR contact_id, so mislabelling a staff recipient does not produce
 * a subtly-wrong row — it throws. The inspector kind already had the property
 * and encoded it as a bare `roleKey === 'inspector'` comparison inside the
 * header writer; a second kind with the same property is the point at which
 * that becomes one rule instead of two literals drifting apart.
 */
export function isStaffRecipient(roleKey: string | null | undefined): boolean {
    return roleKey === 'inspector' || roleKey === STAFF_ROLE_KEY;
}

export interface HasParseChannels {
    parseChannels(raw: string | null): AutomationChannel[];
}
export interface HasEnsureSeeds {
    ensureSeeds(tenantId: string): Promise<void>;
}
export interface HasResolveAddress {
    resolveAddress(
        recipientKind: RecipientKind, recipientRoleProfileId: string | null, channel: AutomationChannel,
        insp: typeof inspections.$inferSelect, db: DrizzleD1Database,
    ): Promise<string | null>;
}
export interface HasEvaluateConditions {
    evaluateConditions(
        db: DrizzleD1Database,
        automation: typeof automations.$inferSelect,
        inspection: FlushInspection,
    ): Promise<{ ok: true } | { ok: false; reason: string }>;
}
export interface HasDeliverSms {
    deliverSms(
        db: DrizzleD1Database,
        ctx: { log: typeof import('../../lib/db/schema').automationLogs.$inferSelect; automation: typeof automations.$inferSelect;
               inspection: FlushInspection; tenant: typeof import('../../lib/db/schema').tenants.$inferSelect },
        sms: import('./sms').SmsRuntime,
        appName: string, appHost: string,
        env?: import('../../lib/sms/managed-send-gate').ManagedSendGateEnv,
        quotaGuard?: import('../../features/plan-quota/guard').PlanQuotaGuard,
    ): Promise<void>;
}

/**
 * Shared base for the AutomationService mixin chain. Holds the injected runtime
 * deps the former monolith carried as constructor parameter-properties, plus the
 * `getDrizzle()` helper every method used. Deps + helper are `protected` (were
 * `private`) so the mixins can read them exactly as the original bodies did.
 */
export class AutomationBase {
    constructor(
        protected db: D1Database,
        protected notification?: import('../notification.service').NotificationService,
        protected agreementService?: import('../agreement.service').AgreementService,
        protected metering?: import('../metering.service').MeteringService,
    ) {}

    protected getDrizzle() { return drizzle(this.db); }
}

/** OI's real-time Clock for the automation core. Edge-only Date.now() (the core
 *  itself never calls it). */
export const oiClock: Clock = { nowMs: () => Date.now() };
