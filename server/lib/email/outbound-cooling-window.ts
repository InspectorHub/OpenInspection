/**
 * The 24-hour outbound cooling window (portal #98, spec §3.2).
 *
 * Platform-funded email to external recipients is unavailable for the first
 * 24 hours of a company's life. What this buys, stated honestly: it defeats
 * the signup -> blast -> abandon loop, which is cheap precisely because it is
 * instant. It does NOT stop a patient attacker; it converts an instant attack
 * into a delayed one. It is only a defence because something looks during the
 * window — see the portal signup-anomaly signal.
 *
 * TWO CONDITIONS, and neither of them is "this code lives in OI":
 *
 *   1. The DEPLOYMENT is SaaS. A self-hosted deployment sends on its
 *      operator's own credentials. That is not our reputation to protect and
 *      not our money, so there is nothing here to gate.
 *   2. The SEND is platform-funded. A tenant who configured their own SMTP /
 *      API key is in the same position as a self-hosted operator, and is
 *      exempt for the same reason — which is also what makes the escape hatch
 *      in the UI notice a real one rather than a consolation.
 *
 * WHY THE COST IS DELIVERABILITY, NOT SENDS. `inspectorhub.io` publishes
 * `p=reject` with Resend and SES aligned. The damage from 50 free emails per
 * throwaway company is what it does to paying customers' report email, not
 * the marginal cost of an SMTP call.
 *
 * ⚠️ There is deliberately NO SMS equivalent — see `../sms/managed-send-gate.ts`.
 */
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { tenants } from '../db/schema';
import { Errors } from '../errors';
import { logger } from '../logger';
import type { DeploymentProfile } from '../deployment-profile';

export const COOLING_WINDOW_HOURS = 24;
export const COOLING_WINDOW_MS = COOLING_WINDOW_HOURS * 60 * 60 * 1000;

/**
 * The notification classes the window NEVER applies to, named one by one.
 *
 * These are the mails that deliver access to an account: block them and a
 * legitimate inspector who signs up on site is locked out of the product
 * rather than merely limited by it. `usage-quota-*` are on the list because
 * they are OUR message about OUR billing to the company owner — telling
 * someone they are about to lose the ability to create inspections is not
 * outbound marketing, and they are already sent on an unmetered service
 * (see `api/inspections/core.ts`), so this is belt and braces.
 *
 * DELIBERATELY ABSENT, and each for a reason worth stating:
 *   - `agent-invite`, `agent-login-link`, `client-portal-login` — these go to
 *     EXTERNAL parties and carry a sign-in link. A fresh throwaway company
 *     blasting 50 "click here to sign in" mails at harvested addresses is
 *     exactly the phishing-shaped payload this window exists to delay.
 *   - `admin-test-send` — its route takes an arbitrary `to` address, so it is
 *     an arbitrary-recipient send path wearing a diagnostic label.
 *
 * ⚠️ A TYPO HERE IS SILENT. A misspelled id simply never matches, the class
 * stays gated, and a new company cannot receive a password reset. Nothing
 * fails loudly. `tests/unit/email/outbound-cooling-window.spec.ts` checks
 * every entry against the class registry for exactly that reason.
 */
export const ACCOUNT_EMAIL_CLASSES: ReadonlySet<string> = new Set([
    'password-reset',
    'workspace-invitation',
    'usage-quota-warning',
    'usage-quota-reached',
]);

/**
 * `undefined` is NOT exempt. A tenant-written automation rule reaches the send
 * boundary with no class id (`automationClassId` returns undefined for it), and
 * automations are one of the four surfaces spec §3.2 gates. Treating "unnamed"
 * as "account email" would exempt the largest gated surface there is.
 */
export function isAccountEmailClass(classId: string | undefined): boolean {
    return classId !== undefined && ACCOUNT_EMAIL_CLASSES.has(classId);
}

/**
 * Both conditions from the header, in one place, with no I/O.
 *
 * Takes the DeploymentProfile rather than a mode string: the deployment
 * condition is read through the capability seam, never off the raw mode env
 * (OI #308 §6.1). A side effect worth having — `mode` is a union of two
 * literals, so the "undefined mode" case a raw string forced this
 * predicate to answer for cannot arise.
 */
export function coolingWindowApplies(input: {
    profile: Pick<DeploymentProfile, 'mode'>;
    platformFunded: boolean;
}): boolean {
    return input.profile.mode === 'saas' && input.platformFunded;
}

/** The instant the window closes, from the CORE `tenants.created_at` anchor. */
export function unlockAtMs(tenantCreatedAtMs: number): number {
    return tenantCreatedAtMs + COOLING_WINDOW_MS;
}

/**
 * The gate's shape at the send boundary. Same idiom as `suppression` and
 * `quota` on EmailBaseService: a small object the assembler either injects or
 * does not, so "off" is expressed by absence rather than by a branch inside
 * the transport.
 */
export interface OutboundCoolingPort {
    check(classId: string | undefined): Promise<void>;
}

/**
 * Reads the CORE anchor, `tenants.created_at` — stamped by the provisioning
 * sync (`server/portal/portal.provider.ts`) seconds after portal stamps its own
 * `approvedAt`, and, unlike `approvedAt`, present in the repository that has to
 * enforce the gate.
 *
 * FAIL-OPEN on an unreadable anchor, and that direction is chosen, not
 * inherited: this is an abuse speed bump, not a security control. Failing
 * closed on a D1 read error would take every company's outbound down on a blip
 * — which is precisely the outage the named error code exists to be
 * distinguishable from.
 *
 * `now` is injectable so a test can hold the clock still; production passes
 * nothing.
 */
export function buildOutboundCoolingWindow(
    db: D1Database,
    tenantId: string,
    now: () => number = Date.now,
): OutboundCoolingPort {
    return {
        async check(classId) {
            if (isAccountEmailClass(classId)) return;

            let createdAt: Date | null | undefined;
            try {
                const row = await drizzle(db)
                    .select({ createdAt: tenants.createdAt })
                    .from(tenants)
                    .where(eq(tenants.id, tenantId))
                    .get();
                createdAt = row?.createdAt;
            } catch {
                createdAt = undefined;
            }

            if (!createdAt) {
                // NO recipient/PII — the fact and the class only.
                logger.warn('[email] cooling-window anchor unreadable — allowing send', {
                    classId: classId ?? null,
                });
                return;
            }

            const unlock = unlockAtMs(createdAt.getTime());
            if (now() >= unlock) return;

            throw Errors.OutboundCoolingWindow({ unlockAtMs: unlock, windowHours: COOLING_WINDOW_HOURS });
        },
    };
}
