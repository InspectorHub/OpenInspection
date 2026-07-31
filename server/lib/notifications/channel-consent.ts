import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { contacts, smsConsentLog, users } from '../db/schema';

/** The BASIS a reader is reachable under — what the ledger's audit column means. */
const basisFor = (a: Audience) => (a === 'client' ? 'client' as const : a === 'agent' ? 'agent' as const : 'staff' as const);
import type { Audience } from './classes';

/**
 * The SMS consent block on the notifications screen (spec §4.2).
 *
 * This is a DIFFERENT question from the grid beside it. Consent answers "may we
 * text you at all" and is the legal record; a preference answers "which of
 * those texts do you want". Someone can consent to texts and still not want
 * booking confirmations, and the send gate already reads them in that order —
 * consent first, then preference — so a screen showing both is the screen
 * agreeing with the code.
 */

export interface SmsConsentBlock {
    /** The number consent attaches to, for the reader to recognise. */
    phone: string | null;
    /**
     * `granted` — an express grant is on file (a consumer).
     * `implied` — a business counterparty under an existing relationship: no
     *   grant to show, but STOP binds exactly the same.
     * `revoked` — they stopped, by STOP or from this screen.
     * `none` — a consumer with nothing on file; we may not text them.
     */
    state: 'granted' | 'implied' | 'revoked' | 'none';
    /** When the state above was recorded. Null for `implied`. */
    at: string | null;
    /** How it was captured — booking form, opt-in link, or by an admin. */
    capturedVia: 'booking_form' | 'optin_link' | 'admin' | null;
    /**
     * WHO a Stop writes against. A client or agent resolves to `contacts` rows;
     * a staff member is a single `users` row and has no contact at all.
     */
    subjects: Array<{ kind: 'contact' | 'user'; id: string }>;
    /**
     * The disclosure the reader must SEE before granting, and its version.
     *
     * Carried with the state because granting inline is only honest if the
     * text was on screen when they agreed — shipping the state without the
     * text is what would turn an inline switch into manufactured evidence.
     */
    disclosure: { version: number; text: string } | null;
}

/**
 * Read the SMS consent block for one reader.
 *
 * STAFF ARE SUPPORTED, and the ledger says so honestly rather than uniformly.
 * A staff subject is a `users` row with `contact_id` left NULL and
 * `recipient_type: 'staff'` — internal-operational under account/employment
 * terms, never consumer consent. They are never GRANTED here (they are implied,
 * like agents); the only staff row that is ever written is a revocation,
 * because a STOP binds whatever basis the first message was sent under.
 *
 * @returns `null` only when there is no subject at all to consent for.
 */
export async function readSmsConsent(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: any,
    tenantId: string,
    audience: Audience,
    subjects: Array<{ kind: 'contact' | 'user'; id: string }>,
    disclosure: { version: number; text: string } | null,
): Promise<SmsConsentBlock | null> {
    if (subjects.length === 0) return null;

    const contactIds = subjects.filter((s) => s.kind === 'contact').map((s) => s.id);
    const userIds = subjects.filter((s) => s.kind === 'user').map((s) => s.id);

    const phoneRows = contactIds.length
        ? await db.select({ phone: contacts.phone }).from(contacts)
            .where(and(eq(contacts.tenantId, tenantId), inArray(contacts.id, contactIds))).all()
        : userIds.length
            ? await db.select({ phone: users.phone }).from(users)
                .where(inArray(users.id, userIds)).all()
            : [];
    const phone = phoneRows.map((r: { phone: string | null }) => r.phone).find(Boolean) ?? null;

    // The LATEST row across every identity this reader holds. Revocation binds
    // regardless of which contact row carried the original grant — the same
    // rule the send gate applies, and the same rule the inbound STOP webhook
    // records against.
    const latest = await db.select({
        action: smsConsentLog.action,
        createdAt: smsConsentLog.createdAt,
        capturedVia: smsConsentLog.capturedVia,
    }).from(smsConsentLog)
        .where(and(
            eq(smsConsentLog.tenantId, tenantId),
            inArray(smsConsentLog.subjectId, subjects.map((s) => s.id)),
        ))
        // Insertion order breaks a same-millisecond tie: a STOP and a START recorded
        // in the same millisecond otherwise resolve arbitrarily, and for a consent
        // ledger "which one is latest" must never be a coin toss.
        .orderBy(desc(smsConsentLog.createdAt), desc(sql`rowid`)).limit(1).get();

    if (latest?.action === 'revoked') {
        return {
            phone, state: 'revoked',
            at: toIso(latest.createdAt), capturedVia: latest.capturedVia ?? null, subjects, disclosure,
        };
    }
    if (latest?.action === 'granted') {
        return {
            phone, state: 'granted',
            at: toIso(latest.createdAt), capturedVia: latest.capturedVia ?? null, subjects, disclosure,
        };
    }

    // Nothing on file. What that MEANS depends on who is asking: a business
    // counterparty and a staff member are reachable under an existing
    // relationship, a consumer is not reachable at all until they say so.
    return {
        phone, state: audience === 'client' ? 'none' : 'implied',
        at: null, capturedVia: null, subjects, disclosure,
    };
}

function toIso(v: unknown): string | null {
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'number') return new Date(v).toISOString();
    return null;
}

/**
 * Record that this reader stopped a channel.
 *
 * SMS ONLY writes anything here, because the two channels are not symmetrical
 * (§4.2): `sms_consent_log` is a legal record and email has no equivalent —
 * only deliverability suppression, which is a different fact. Email's "off" is
 * the preference cascade alone, and the caller does that part for both.
 *
 * Delegates to `SmsConsentService.record` rather than inserting directly: that
 * is what stamps the CURRENT disclosure version, and a hand-rolled insert would
 * drift from the version the opt-in page and the STOP webhook both use — three
 * writers disagreeing about what the recipient was shown.
 *
 * There is deliberately no "switch back on". Granting consent means recording a
 * disclosure version, a capture method, an ip and a user agent — evidence only
 * the opt-in page can honestly produce. A screen that flipped it inline would
 * be manufacturing that evidence, so the reader is sent to `/sms-optin/:token`.
 */
export interface ConsentRecorder {
    record(
        tenantId: string, contactId: string, action: 'granted' | 'revoked',
        capturedVia: 'booking_form' | 'optin_link' | 'admin' | 'settings_page',
        meta: {
            ip?: string | undefined; userAgent?: string | undefined;
            recipientType?: 'client' | 'agent' | 'other' | 'staff';
            subjectKind?: 'contact' | 'user';
        },
    ): Promise<unknown>;
}

/**
 * Record that this reader granted the text channel, from this screen.
 *
 * Only legitimate when the disclosure was RENDERED and its version comes back
 * with the acknowledgement — which is why the version is a parameter and not
 * something this function looks up. A caller that could pass any version would
 * be able to record consent to text the reader never saw.
 */
export async function grantSms(
    recorder: ConsentRecorder,
    tenantId: string,
    block: SmsConsentBlock,
    audience: Audience,
    meta: { ip?: string | undefined; userAgent?: string | undefined },
): Promise<void> {
    // Only consumers are ever GRANTED here. Agents and staff are implied, and
    // writing a grant for them would put non-consumer messaging inside the
    // consumer consent evidence (docs/sms-compliance.md).
    if (audience !== 'client') return;
    for (const s of block.subjects) {
        await recorder.record(tenantId, s.id, 'granted', 'settings_page', {
            ...meta, recipientType: 'client', subjectKind: s.kind,
        });
    }
}

export async function revokeChannel(
    recorder: ConsentRecorder,
    tenantId: string,
    channel: 'email' | 'sms',
    block: SmsConsentBlock | null,
    audience: Audience,
): Promise<void> {
    if (channel !== 'sms' || !block) return;
    // An agent's revocation is recorded AS an agent's. The column exists so the
    // ledger says which basis the person was reachable under, and stamping
    // everyone 'client' would make the evidence wrong in the one direction that
    // matters to a carrier audit.
    for (const s of block.subjects) {
        await recorder.record(tenantId, s.id, 'revoked', 'optin_link', {
            recipientType: basisFor(audience), subjectKind: s.kind,
        });
    }
}
