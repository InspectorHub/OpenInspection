import { drizzle } from 'drizzle-orm/d1';

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
import type { automations, inspections } from '../../lib/db/schema';

export interface HasParseChannels {
    parseChannels(raw: string | null): ('email' | 'sms')[];
}
export interface HasEnsureSeeds {
    ensureSeeds(tenantId: string): Promise<void>;
}
export interface HasResolveAddress {
    resolveAddress(
        recipient: string, channel: 'email' | 'sms',
        insp: typeof inspections.$inferSelect, db: DrizzleD1Database,
    ): Promise<string | null>;
}
export interface HasTitleFor {
    titleFor(event: string, insp: typeof inspections.$inferSelect): string;
}
export interface HasEvaluateConditions {
    evaluateConditions(
        db: DrizzleD1Database,
        automation: typeof automations.$inferSelect,
        inspection: typeof inspections.$inferSelect,
    ): Promise<{ ok: true } | { ok: false; reason: string }>;
}
export interface HasDeliverSms {
    deliverSms(
        db: DrizzleD1Database,
        ctx: { log: typeof import('../../lib/db/schema').automationLogs.$inferSelect; automation: typeof automations.$inferSelect;
               inspection: typeof inspections.$inferSelect; tenant: typeof import('../../lib/db/schema').tenants.$inferSelect },
        sms: { resolveCreds: (tenantId: string) => Promise<import('../../lib/sms/resolve-twilio').TwilioCreds | null> } | null | undefined,
        appName: string, appHost: string,
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
