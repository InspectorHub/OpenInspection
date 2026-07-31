import { and, eq } from 'drizzle-orm';
// Loose row type: callers pass their own drizzle instance and this only reads
// one table, so pinning the generic would couple it to each caller's schema map.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDrizzle = { select: (...args: any[]) => any };
import { contactRoleProfiles } from '../db/schema';
import { createOiTemplateStore } from '../../services/automation/template-store';
import { logger } from '../logger';

export interface RoleEmailTemplate {
    subject: string;
    body: string;
    roleLabel: string;
}

export interface RoleSmsTemplate {
    body: string;
    roleLabel: string;
}

/**
 * The email template a role profile names, for the MANUAL report send.
 *
 * `contact_role_profiles.email_template_id` was written by the Edit Role modal
 * and read by nothing — an operator could set a template, save successfully,
 * and no send path would consult it. A control that silently does nothing is
 * worse than a missing one: it reads as configured.
 *
 * Scoped to the manual send deliberately. A template hanging off a role cannot
 * express WHEN to send, which is what makes it useless as a general mechanism —
 * triggered messaging belongs to Automations, which models it properly with a
 * trigger and its own recipient targeting. The one moment a role template can
 * honestly mean something is when an operator presses Send.
 *
 * Returns null — "use the default report copy" — for every unhappy case:
 * unknown role key, inactive profile, no template set, template deleted, or a
 * template that turns out to be SMS. A manual send must never fail or go silent
 * because a template reference went stale; the recipient still gets their
 * report, just in the standard wording.
 *
 * A missing subject counts as no template rather than sending mail with an
 * empty subject line, which reads as spam and is worse than the default.
 */
export async function resolveRoleEmailTemplate(
    db: AnyDrizzle,
    rawDb: D1Database,
    tenantId: string,
    roleKey: string,
): Promise<RoleEmailTemplate | null> {
    try {
        const profile = await db
            .select({
                label: contactRoleProfiles.label,
                emailTemplateId: contactRoleProfiles.emailTemplateId,
            })
            .from(contactRoleProfiles)
            .where(and(
                eq(contactRoleProfiles.tenantId, tenantId),
                eq(contactRoleProfiles.key, roleKey),
                eq(contactRoleProfiles.active, true),
            ))
            .get();
        if (!profile?.emailTemplateId) return null;

        const tpl = await createOiTemplateStore(rawDb).resolve(tenantId, profile.emailTemplateId);
        if (!tpl || tpl.channel !== 'email' || !tpl.subject) return null;
        return { subject: tpl.subject, body: tpl.body, roleLabel: profile.label };
    } catch (err) {
        logger.warn('[send-report] role template lookup failed; using default copy', {
            tenantId, roleKey, error: err instanceof Error ? err.message : String(err),
        });
        return null;
    }
}

/**
 * The SMS template a role profile names, for the MANUAL SMS send (A3.4).
 *
 * Same six-way null posture as the email sibling: missing/inactive/wrong-
 * channel/empty body → null, and the caller falls back to a default. A stale
 * reference must never be the reason someone is not texted when the operator
 * pressed Send — the consent gate is the only honest skip.
 */
export async function resolveRoleSmsTemplate(
    db: AnyDrizzle,
    rawDb: D1Database,
    tenantId: string,
    roleKey: string,
): Promise<RoleSmsTemplate | null> {
    try {
        const profile = await db
            .select({
                label: contactRoleProfiles.label,
                smsTemplateId: contactRoleProfiles.smsTemplateId,
            })
            .from(contactRoleProfiles)
            .where(and(
                eq(contactRoleProfiles.tenantId, tenantId),
                eq(contactRoleProfiles.key, roleKey),
                eq(contactRoleProfiles.active, true),
            ))
            .get();
        if (!profile?.smsTemplateId) return null;

        const tpl = await createOiTemplateStore(rawDb).resolve(tenantId, profile.smsTemplateId);
        if (!tpl || tpl.channel !== 'sms' || !tpl.body.trim()) return null;
        return { body: tpl.body, roleLabel: profile.label };
    } catch (err) {
        logger.warn('[send-sms] role template lookup failed; using default copy', {
            tenantId, roleKey, error: err instanceof Error ? err.message : String(err),
        });
        return null;
    }
}
