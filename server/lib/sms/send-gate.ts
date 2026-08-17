/**
 * The one gate chain every outbound SMS passes through.
 *
 * There used to be three copies: the real send path (`sendOneSms`), the
 * template test send, and the settings "test connection" send. They did not
 * BYPASS the gates — that would be the obvious bug and it is not the one that
 * was present. They each carried their own copy of the chain, and a copy only
 * has the gates someone remembered to add to it.
 *
 * That is not theoretical. When the STOP-revocation check was added, it landed
 * in exactly one of the three. Nobody skipped a step; the other two simply were
 * not there to receive it. A copied chain does this every time, and it would
 * have done it again for the next gate.
 *
 * So the chain lives here once, and a caller declares its `purpose` instead of
 * declaring nothing and being exempt from whatever was not copied. The
 * exemptions are stated below, in one place, where they can be argued with.
 *
 * WHAT STAYS WITH THE CALLER: writing `automation_logs` rows, resolving the
 * body template, and the provider call itself. This function decides whether
 * the send may happen; it does not perform it.
 */
import { and, eq, desc, sql } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { contacts, smsConsentLog, tenantConfigs } from '../db/schema';
import { managedSendAllowed, type ManagedSendGateEnv } from './managed-send-gate';
import { requiresExpressSmsConsent } from './consent-basis';
import { normalizeE164 } from './phone';
import type { RoleKind } from '../people/role-kinds';
import type { PlanQuotaGuard } from '../../features/plan-quota/guard';
import { logger } from '../logger';
import { isPreferenceMuted } from '../notifications/preference-port';
import { categoryOf } from '../notifications/classes';
import { marketingVarsIn } from './marketing-content';

/**
 * Why this message is being sent — and therefore which gates it is exempt from.
 *
 * - `notification` — a real message to a real recipient. Every gate applies.
 * - `test` — an operator sending to a number they control, to check that SMS
 *   works at all. Exempt from the EXPRESS-CONSENT requirement only, and only
 *   because there is no contact to hold consent: nothing exists to consult, so
 *   requiring it would mean no test send could ever succeed.
 *
 *   `test` is NOT exempt from revocation. Honoring STOP does not depend on the
 *   basis the first message was sent under, and it does not care that this one
 *   is a test — a tenant testing against a number that texted STOP should be
 *   told so, not quietly sent to.
 */
type SmsPurpose = 'notification' | 'test';

export type SmsGateOutcome =
    | { allowed: true; smsMode: string; companyPhone: string | null; reviewUrl: string | null; companyName: string | null }
    | { allowed: false; reason: string };

export interface SmsGateArgs {
    // Callers pass tenant-scoped drizzle handles with different schema maps;
    // this only touches a handful of tables by name.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: DrizzleD1Database<any>;
    tenantId: string;
    /** Destination number, in whatever shape the caller holds it. */
    to: string;
    purpose: SmsPurpose;
    /**
     * The contact this message is addressed to, when one is known.
     *
     * A notification knows it (stamped on the log at enqueue). A test send does
     * not, so revocation falls back to matching the NUMBER — which is the same
     * match the inbound STOP webhook makes when it records the revocation, and
     * therefore finds the same rows.
     */
    contactId?: string | null;
    /** Consent basis for the recipient. Only consulted when `purpose` is `notification`. */
    roleKind?: RoleKind;
    env?: ManagedSendGateEnv | undefined;
    /**
     * WHAT is being sent — a `NOTIFICATION_CLASSES` id.
     *
     * Without it this gate cannot consult the recipient's own preference, and
     * the screen grows a text switch that writes a row nothing reads. Absent ⇒
     * the send is UNCLASSIFIED and therefore never muted (`isSuppressible`
     * fails closed), which is the right answer for an admin test send.
     *
     * A preference can only ever NARROW what consent already allows (§3.3):
     * it is checked AFTER consent, never instead of it, so muting a class can
     * never turn an un-consented number into a sendable one.
     *
     * A class id the registry does not know is REFUSED, not defaulted. See the
     * marketing block below for why an unknown class cannot be assumed
     * transactional.
     */
    classId?: string | undefined;
    /**
     * The body about to be sent, BEFORE `{{var}}` interpolation.
     *
     * REQUIRED, and deliberately so. This gate's marketing check only fires on
     * what it is given, so an optional argument would make every future call
     * site a silent bypass — the caller that forgets it would be the caller
     * that sends the marketing text. Required makes forgetting a build error.
     *
     * A caller with no template still passes what it will actually send: the
     * settings test-connection sends a fixed diagnostic sentence and hands that
     * sentence over. `''` is accepted and means "nothing to inspect", but it
     * has to be written down at the call site rather than arrived at by
     * omission.
     */
    bodyTemplate: string;
    /** Absent ⇒ no quota enforcement (standalone, BYO, or a non-quota deployment). */
    quota?: { guard: PlanQuotaGuard; tier: string } | undefined;
}

/** Latest consent action for a contact, or null when it has no ledger. */
async function latestConsent(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: DrizzleD1Database<any>,
    tenantId: string,
    subjectId: string,
): Promise<'granted' | 'revoked' | null> {
    // Keyed on `subject_id`, not `contact_id`, so a STAFF revocation (a `users`
    // subject, whose `contact_id` is null) is honoured by the same lookup. The
    // two agree for every contact row — the backfill set subject_id from
    // contact_id — so this widens the gate without changing any existing answer.
    const row = await db.select({ action: smsConsentLog.action }).from(smsConsentLog)
        .where(and(eq(smsConsentLog.tenantId, tenantId), eq(smsConsentLog.subjectId, subjectId)))
        // Insertion order breaks a same-millisecond tie: a STOP and a START recorded
        // in the same millisecond otherwise resolve arbitrarily, and for a consent
        // ledger "which one is latest" must never be a coin toss.
        .orderBy(desc(smsConsentLog.createdAt), desc(sql`rowid`)).limit(1).get();
    return (row?.action as 'granted' | 'revoked' | undefined) ?? null;
}

/**
 * Contacts in this tenant whose number is the one being texted.
 *
 * Matches on the NORMALIZED phone, because stored phones may not be — the
 * inbound STOP webhook normalizes on read for exactly this reason, and if the
 * two matchers disagreed, a revocation could be recorded against a contact this
 * check would then fail to find.
 */
async function contactIdsForPhone(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: DrizzleD1Database<any>,
    tenantId: string,
    to: string,
): Promise<string[]> {
    const target = normalizeE164(to);
    if (!target) return [];
    const rows = await db.select({ id: contacts.id, phone: contacts.phone })
        .from(contacts).where(eq(contacts.tenantId, tenantId)).all();
    return rows.filter((r) => normalizeE164(r.phone) === target).map((r) => r.id);
}

export async function smsSendGate(args: SmsGateArgs): Promise<SmsGateOutcome> {
    const { db, tenantId, to, purpose, contactId, roleKind, env, quota, classId, bodyTemplate } = args;

    // A tenant with no config row is 'platform' — the same default all three
    // chains already used. Wrapped rather than `.catch()`-chained because some
    // drizzle handles return a thenable-only builder from `.get()`.
    let cfg: { smsMode: string; companyPhone: string | null; reviewUrl: string | null; companyName: string | null } | null | undefined;
    try {
        cfg = await db.select({
            smsMode:      tenantConfigs.smsMode,
            companyPhone: tenantConfigs.companyPhone,
            reviewUrl:    tenantConfigs.reviewUrl,
            // Read here rather than by a second query in the caller: this is
            // the one place that already holds the tenant's config row, and the
            // sender-identity record the send path writes needs the brand a
            // recipient actually sees (counsel 26-5).
            companyName:  tenantConfigs.companyName,
        }).from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantId)).get();
    } catch { cfg = null; }
    const smsMode = cfg?.smsMode ?? 'platform';

    // ── Consent. Two DIFFERENT rules, and conflating them is what let a revoked
    // agent keep receiving texts.
    //
    // REVOCATION BINDS EVERYONE. It does not depend on the basis the first
    // message was sent under — it is the one CTIA rule that is universal, and
    // both published documents warrant it (ToS: STOP is honored "for all
    // outbound recipients"; privacy notice: business counterparties keep STOP
    // available).
    //
    // EXPRESS CONSENT is required only of consumers (client kind). Agents,
    // other business counterparties and staff are implied (D5 + A3.2); the
    // absence of a granted row is not a reason to withhold from them.
    const consultable = contactId ? [contactId] : await contactIdsForPhone(db, tenantId, to);
    for (const id of consultable) {
        if (await latestConsent(db, tenantId, id) === 'revoked') {
            // Distinct reason string: "opted out" and "never opted in" are
            // different facts, and the Outbox / inbox reason maps read them.
            return { allowed: false, reason: 'sms opt-out' };
        }
    }
    if (purpose === 'notification' && requiresExpressSmsConsent(roleKind ?? 'client')) {
        // No identifiable contact means nothing to check consent against, and a
        // consumer fails closed.
        if (!contactId) return { allowed: false, reason: 'no sms consent' };
        if (await latestConsent(db, tenantId, contactId) !== 'granted') {
            return { allowed: false, reason: 'no sms consent' };
        }
    }

    // ── Marketing may not ride a transactional consent.
    //
    // The consent we hold was captured under a disclosure describing
    // appointment and report updates. A review request is promotional, which
    // changes which consent the message needs, so counsel's ruling is to refuse
    // marketing on this channel outright until a separate marketing-SMS consent
    // exists. It is decided HERE and not in the template editor because a
    // tenant can write any body they like: "do not leave the compliance
    // decision to the content author."
    //
    // WHY BOTH CHECKS. The class check sees anything carrying a seeded class
    // id. It cannot see a tenant-authored template, which has no class by
    // construction — the content check is the half that can. Neither subsumes
    // the other.
    //
    // WHY HERE — after revocation and consent, before the preference lookup.
    // Placed after the preference check instead, a muted-but-consented
    // recipient would decide the question consent should have decided: the
    // refusal would come back as "recipient switched this off" and the fact
    // that we may not send this content AT ALL would never be recorded. A
    // message that may not be sent must not have its reason chosen by whether
    // someone happened to mute the class.
    //
    // The type says this cannot be absent, and that is the primary defence —
    // an omitting call site does not compile. The runtime check is here for the
    // callers a type cannot reach (an `as any` handle, a spec, a JS consumer of
    // the built worker): absence must be a REFUSAL, never a skipped check.
    if (typeof bodyTemplate !== 'string') {
        logger.error('[sms-gate] called with no message body; refusing', { tenantId, classId });
        return { allowed: false, reason: 'sms gate called with no message body' };
    }
    const marketing = marketingVarsIn(bodyTemplate);
    if (marketing.length > 0) {
        return { allowed: false, reason: `marketing content on sms: ${marketing.join(', ')}` };
    }
    if (classId) {
        const category = categoryOf(classId);
        // Undefined is NOT 'transactional'. `categoryOf` returns it for an id
        // outside the registry — a typo, or a class deleted while a caller
        // still names it — and a caller that cannot say what it is sending must
        // not be able to send it on a consent that was never given for it.
        // There is deliberately no default here.
        if (category === undefined) {
            logger.warn('[sms-gate] refusing an unknown notification class', { tenantId, classId });
            return { allowed: false, reason: `unknown notification class on sms: ${classId}` };
        }
        if (category === 'marketing') {
            return { allowed: false, reason: 'marketing class on sms' };
        }
    }

    // ── The recipient's own preference, AFTER consent and BEFORE quota.
    //
    // After consent because a preference narrows what consent allows and must
    // never widen it. Before quota because a text nobody wanted must not spend
    // the tenant's allowance — the same ordering the email boundary uses.
    if (classId && consultable.length > 0) {
        const muted = await isPreferenceMuted(
            db, tenantId, classId, 'sms',
            consultable.map((id) => ({ kind: 'contact' as const, id })),
        ).catch(() => false); // Fail OPEN: a failed lookup must not silence a send.
        if (muted) return { allowed: false, reason: 'recipient switched this off' };
    }

    const gate = await managedSendAllowed(db, env ?? {}, tenantId, smsMode);
    if (!gate.allowed) {
        logger.info('[sms-gate] blocked by managed compliance gate', { tenantId, reason: gate.reason });
        return { allowed: false, reason: gate.reason ?? 'managed_not_approved' };
    }

    // 'own' is BYO and uncapped. THROWS on exhaustion (402) rather than
    // returning — every caller already surfaces that as an error response, and
    // a quota block is not the same kind of answer as "this recipient opted
    // out".
    if (quota && smsMode !== 'own') {
        await quota.guard.checkMessagingQuota(tenantId, quota.tier, 'sms');
    }

    return {
        allowed: true,
        smsMode,
        companyPhone: cfg?.companyPhone ?? null,
        reviewUrl: cfg?.reviewUrl ?? null,
        companyName: cfg?.companyName ?? null,
    };
}
