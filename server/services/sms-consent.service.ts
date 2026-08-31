import { drizzle } from 'drizzle-orm/d1';
import { and, eq, desc, sql } from 'drizzle-orm';
import { smsConsentLog, smsDisclosureVersions } from '../lib/db/schema';
import { nanoid } from 'nanoid';
import { sha256Hex } from '../lib/sha256';

export type ConsentAction = 'granted' | 'revoked';
export type CapturedVia = 'booking_form' | 'optin_link' | 'admin';

export class SmsConsentService {
    constructor(private db: D1Database) {}
    private getDrizzle() { return drizzle(this.db); }

    /**
     * Publish a disclosure version (max+1), hashing its text.
     *
     * Republishing the CURRENT version's exact text returns that version
     * unchanged instead of minting a new one — the same no-op-on-identical-prose
     * behaviour `legal-version.service.ts` has, and for the same reason: a second
     * version indistinguishable from the first makes a consent ledger harder to
     * read, not more precise. The comparison is on the hash rather than on the
     * strings so it says out loud what the stored column is for.
     *
     * Only the CURRENT version is compared. Reviving the text of an older
     * version is a real publication (the words become current again) and gets its
     * own row and its own timestamp.
     *
     * A version published before hashing existed carries no hash, so it never
     * matches and republishing its exact text does mint a new version. That is
     * the right outcome rather than an edge case to smooth over: we cannot show
     * the older row still says what it said, and the new row can.
     */
    async publishDisclosure(text: string): Promise<number> {
        const db = this.getDrizzle();
        const contentHash = await sha256Hex(text);
        const cur = await db.select().from(smsDisclosureVersions)
            .orderBy(desc(smsDisclosureVersions.version)).limit(1).get();
        if (cur && cur.contentHash === contentHash) return cur.version;
        const version = (cur?.version ?? 0) + 1;
        await db.insert(smsDisclosureVersions).values({ version, text, publishedAt: new Date(), contentHash });
        return version;
    }

    /**
     * There is no amend path, and this method exists to say so where someone
     * would look for one. A published disclosure is what a consumer was shown;
     * editing it rewrites evidence rather than correcting a record. Publish a new
     * version.
     */
     
    async amendDisclosure(version: number, _text: string): Promise<never> {
        throw new Error(`sms disclosure v${version} is immutable — publish a new version instead`);
    }

    async currentDisclosure(): Promise<{ version: number; text: string; contentHash: string | null } | null> {
        const db = this.getDrizzle();
        const row = await db.select().from(smsDisclosureVersions)
            .orderBy(desc(smsDisclosureVersions.version)).limit(1).get();
        return row ? { version: row.version, text: row.text, contentHash: row.contentHash } : null;
    }

    /**
     * Append a consent event, stamping the current disclosure version.
     *
     * The SUBJECT is a contact by default, because every capture path that
     * existed before staff STOP was a consumer one. A staff subject passes
     * `subjectKind: 'user'`, which leaves `contact_id` NULL — a staff member is
     * a `users` row and has no contact to attach consent to.
     *
     * `recipientType` records the BASIS, not the subject kind: `staff` means
     * internal-operational under account/employment terms, never consumer
     * consent, so a staff STOP can be honoured without its row being read as
     * evidence in a consumer filing.
     */
    async record(
        tenantId: string, subjectId: string, action: ConsentAction, capturedVia: CapturedVia,
        meta: {
            ip?: string | undefined; userAgent?: string | undefined;
            recipientType?: import('../lib/sms/consent-basis').ConsentRecipientType;
            subjectKind?: 'contact' | 'user';
        },
    ) {
        const db = this.getDrizzle();
        const disc = await this.currentDisclosure();
        const subjectKind = meta.subjectKind ?? ('contact' as const);
        const row = {
            id: nanoid(), tenantId,
            // NULL for a user subject: there is no contact, and writing the
            // user id here would make the column lie about what it holds.
            contactId: subjectKind === 'contact' ? subjectId : null,
            subjectKind, subjectId,
            recipientType: meta.recipientType ?? ('client' as const),
            action, disclosureVersion: disc?.version ?? 0, capturedVia,
            ip: meta.ip ?? null, userAgent: meta.userAgent ?? null, createdAt: new Date(),
            // The words, not just the pointer. NULL when the version predates
            // hashing or when there is no disclosure at all — an honest absence,
            // never a hash of whatever the text happens to say now.
            disclosureContentHash: disc?.contentHash ?? null,
        };
        await db.insert(smsConsentLog).values(row);
        return row;
    }

    /** Latest event for one subject, or null if none. */
    async getLatest(
        tenantId: string, subjectId: string, subjectKind: 'contact' | 'user' = 'contact',
    ): Promise<ConsentAction | null> {
        const db = this.getDrizzle();
        const row = await db.select({ action: smsConsentLog.action }).from(smsConsentLog)
            .where(and(
                eq(smsConsentLog.tenantId, tenantId),
                eq(smsConsentLog.subjectKind, subjectKind),
                eq(smsConsentLog.subjectId, subjectId),
            ))
            // Insertion order breaks a same-millisecond tie: a STOP and a START recorded
        // in the same millisecond otherwise resolve arbitrarily, and for a consent
        // ledger "which one is latest" must never be a coin toss.
        .orderBy(desc(smsConsentLog.createdAt), desc(sql`rowid`)).limit(1).get();
        return (row?.action as ConsentAction) ?? null;
    }
}
