import { and, desc, eq, inArray } from 'drizzle-orm';
import { contacts, smsConsentLog } from '../db/schema';
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
    /** The contact rows this reader is, so a Stop knows what to write. */
    contactIds: string[];
}

/**
 * Read the SMS consent block for one reader.
 *
 * @returns `null` when the block must NOT render — which today is every staff
 *          reader. Consent attaches to a `contacts` row and a staff member is a
 *          `users` row; there is also no user-facing notification class that is
 *          both staff-addressed and SMS, so there is nothing to revoke.
 *          Inventing a staff consent row to make the screen look uniform would
 *          be a control over nothing, which is worse than no control (§4.2).
 */
export async function readSmsConsent(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: any,
    tenantId: string,
    audience: Audience,
    contactIds: string[],
): Promise<SmsConsentBlock | null> {
    if (contactIds.length === 0) return null;

    const rows = await db.select({ phone: contacts.phone })
        .from(contacts)
        .where(and(eq(contacts.tenantId, tenantId), inArray(contacts.id, contactIds)))
        .all();
    const phone = rows.map((r: { phone: string | null }) => r.phone).find(Boolean) ?? null;

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
            inArray(smsConsentLog.contactId, contactIds),
        ))
        .orderBy(desc(smsConsentLog.createdAt)).limit(1).get();

    if (latest?.action === 'revoked') {
        return {
            phone, state: 'revoked',
            at: toIso(latest.createdAt), capturedVia: latest.capturedVia ?? null, contactIds,
        };
    }
    if (latest?.action === 'granted') {
        return {
            phone, state: 'granted',
            at: toIso(latest.createdAt), capturedVia: latest.capturedVia ?? null, contactIds,
        };
    }

    // Nothing on file. What that MEANS depends on who is asking: a business
    // counterparty is reachable under an existing relationship, a consumer is
    // not reachable at all until they say so.
    return {
        phone, state: audience === 'agent' ? 'implied' : 'none',
        at: null, capturedVia: null, contactIds,
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
        capturedVia: 'booking_form' | 'optin_link' | 'admin',
        meta: { ip?: string | undefined; userAgent?: string | undefined; recipientType?: 'client' | 'agent' | 'other' },
    ): Promise<unknown>;
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
    const recipientType = audience === 'agent' ? 'agent' as const : 'client' as const;
    for (const contactId of block.contactIds) {
        await recorder.record(tenantId, contactId, 'revoked', 'optin_link', { recipientType });
    }
}
