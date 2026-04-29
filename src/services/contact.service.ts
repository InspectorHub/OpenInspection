import { drizzle } from 'drizzle-orm/d1';
import { eq, and, like, sql } from 'drizzle-orm';
import { contacts } from '../lib/db/schema/contact';
import { inspections } from '../lib/db/schema/inspection';
import { Errors } from '../lib/errors';
import { safeISODate } from '../lib/date';

export class ContactService {
    constructor(private db: D1Database) {}

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private getDrizzle() { return drizzle(this.db as any); }

    async listContacts(tenantId: string, opts: { type?: 'agent' | 'client'; search?: string; limit: number; offset: number }) {
        const db = this.getDrizzle();
        const conditions = [eq(contacts.tenantId, tenantId)];
        if (opts.type) conditions.push(eq(contacts.type, opts.type));
        if (opts.search) conditions.push(like(contacts.name, `%${opts.search}%`));

        const rows = await db.select().from(contacts).where(and(...conditions)).limit(opts.limit).offset(opts.offset).all();

        const withCounts = await Promise.all(rows.map(async (c) => {
            if (c.type !== 'agent') return { ...c, inspectionCount: 0 };
            const res = await db.select({ count: sql<number>`count(*)` }).from(inspections)
                .where(and(eq(inspections.tenantId, tenantId), eq(inspections.referredByAgentId, c.id))).get();
            return { ...c, inspectionCount: res?.count ?? 0 };
        }));

        return withCounts.map(c => ({ ...c, createdAt: safeISODate(c.createdAt) }));
    }

    async createContact(tenantId: string, data: { type: 'agent' | 'client'; name: string; email?: string | null | undefined; phone?: string | null | undefined; agency?: string | null | undefined; notes?: string | null | undefined }) {
        const db = this.getDrizzle();
        const normalized = {
            email: data.email ?? null,
            phone: data.phone ?? null,
            agency: data.agency ?? null,
            notes: data.notes ?? null,
        };
        const row = { id: crypto.randomUUID(), tenantId, createdAt: new Date(), type: data.type, name: data.name, ...normalized };
        await db.insert(contacts).values(row);
        return { ...row, createdAt: safeISODate(row.createdAt), inspectionCount: 0 };
    }

    async updateContact(id: string, tenantId: string, data: Partial<{ type: 'agent' | 'client'; name: string; email: string | null; phone: string | null; agency: string | null; notes: string | null }>) {
        const db = this.getDrizzle();
        const existing = await db.select().from(contacts).where(and(eq(contacts.id, id), eq(contacts.tenantId, tenantId))).get();
        if (!existing) throw Errors.NotFound('Contact not found');
        await db.update(contacts).set(data).where(and(eq(contacts.id, id), eq(contacts.tenantId, tenantId)));
        return { ...existing, ...data, createdAt: safeISODate(existing.createdAt) };
    }

    async deleteContact(id: string, tenantId: string) {
        const db = this.getDrizzle();
        const existing = await db.select().from(contacts).where(and(eq(contacts.id, id), eq(contacts.tenantId, tenantId))).get();
        if (!existing) throw Errors.NotFound('Contact not found');
        await db.delete(contacts).where(and(eq(contacts.id, id), eq(contacts.tenantId, tenantId)));
    }
}
