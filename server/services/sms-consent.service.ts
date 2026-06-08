import { drizzle } from 'drizzle-orm/d1';
import { and, eq, desc, max } from 'drizzle-orm';
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

    /** Append a consent event for a client contact, stamping the current disclosure version. */
    async record(
        tenantId: string, contactId: string, action: ConsentAction, capturedVia: CapturedVia,
        meta: { ip?: string | undefined; userAgent?: string | undefined },
    ) {
        const db = this.getDrizzle();
        const disc = await this.currentDisclosure();
        const row = {
            id: nanoid(), tenantId, contactId, recipientType: 'client' as const,
            action, disclosureVersion: disc?.version ?? 0, capturedVia,
            ip: meta.ip ?? null, userAgent: meta.userAgent ?? null, createdAt: new Date(),
        };
        await db.insert(smsConsentLog).values(row);
        return row;
    }

    /** Latest event for (tenant, contact), or null if none. */
    async getLatest(tenantId: string, contactId: string): Promise<ConsentAction | null> {
        const db = this.getDrizzle();
        const row = await db.select({ action: smsConsentLog.action }).from(smsConsentLog)
            .where(and(eq(smsConsentLog.tenantId, tenantId), eq(smsConsentLog.contactId, contactId)))
            .orderBy(desc(smsConsentLog.createdAt)).limit(1).get();
        return (row?.action as ConsentAction) ?? null;
    }
}
