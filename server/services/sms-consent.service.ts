import { drizzle } from 'drizzle-orm/d1';
import { and, eq, desc, max, sql } from 'drizzle-orm';
import { smsConsentLog, smsDisclosureVersions } from '../lib/db/schema';
import { nanoid } from 'nanoid';

export type ConsentAction = 'granted' | 'revoked';
export type CapturedVia = 'booking_form' | 'optin_link' | 'admin';

export class SmsConsentService {
    constructor(private db: D1Database) {}
    private getDrizzle() { return drizzle(this.db); }

    /** Publish a new disclosure version (max+1). Returns the new version number. */
    async publishDisclosure(text: string): Promise<number> {
        const db = this.getDrizzle();
        const cur = await db.select({ v: max(smsDisclosureVersions.version) }).from(smsDisclosureVersions).get();
        const version = (cur?.v ?? 0) + 1;
        await db.insert(smsDisclosureVersions).values({ version, text, publishedAt: new Date() });
        return version;
    }

    async currentDisclosure(): Promise<{ version: number; text: string } | null> {
        const db = this.getDrizzle();
        const row = await db.select().from(smsDisclosureVersions)
            .orderBy(desc(smsDisclosureVersions.version)).limit(1).get();
        return row ? { version: row.version, text: row.text } : null;
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
