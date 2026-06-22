import { drizzle } from 'drizzle-orm/d1';
import { eq, and, like, sql, isNull, or, inArray, isNotNull } from 'drizzle-orm';
import { contacts } from '../lib/db/schema/contact';
import { inspections } from '../lib/db/schema/inspection';
import { invoices } from '../lib/db/schema/invoice';
import { Errors } from '../lib/errors';
import { escapeLikePattern } from '../lib/db/like-escape';
import { safeISODate } from '../lib/date';

export class ContactService {
    constructor(private db: D1Database) {}

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private getDrizzle() { return drizzle(this.db as any); }

    async listContacts(tenantId: string, opts: { type?: 'agent' | 'client'; search?: string; limit: number; offset: number }) {
        const db = this.getDrizzle();
        const conditions = [eq(contacts.tenantId, tenantId)];
        if (opts.type) conditions.push(eq(contacts.type, opts.type));
        if (opts.search) conditions.push(like(contacts.name, `%${escapeLikePattern(opts.search)}%`));

        const rows = await db.select().from(contacts).where(and(...conditions)).limit(opts.limit).offset(opts.offset).all();

        const withCounts = await Promise.all(rows.map(async (c) => {
            if (c.type === 'agent') {
                const res = await db.select({ count: sql<number>`count(*)` }).from(inspections)
                    .where(and(eq(inspections.tenantId, tenantId), eq(inspections.referredByAgentId, c.id))).get();
                return { ...c, inspectionCount: res?.count ?? 0 };
            }
            if (c.type === 'client' && c.email) {
                const res = await db.select({ count: sql<number>`count(*)` }).from(inspections)
                    .where(and(eq(inspections.tenantId, tenantId), eq(inspections.clientEmail, c.email))).get();
                return { ...c, inspectionCount: res?.count ?? 0 };
            }
            return { ...c, inspectionCount: 0 };
        }));

        return withCounts.map(c => ({ ...c, createdAt: safeISODate(c.createdAt) }));
    }

    /**
     * IA-18 (#111) — contact detail page payload: the contact, its inspection
     * history (date desc), and aggregate stats.
     *
     * History linkage:
     *  - agent  → inspections where referredByAgentId = id OR sellingAgentId = id
     *             (legacy FK), deduped by inspection id.
     *  - client → inspections where clientContactId = id OR (the contact has an
     *             email AND clientEmail = that email) — the DUAL PATH that
     *             recovers legacy rows created before IA-1 stamped
     *             clientContactId. Deduped by inspection id.
     *
     * Archived contacts STILL return detail (the history stays useful after a
     * soft-delete). Cross-tenant / unknown ids return null.
     *
     * Revenue authority chain (DB-5): revenue = Σ amountCents of PAID invoices
     * (paidAt IS NOT NULL) joined on those inspection ids — money actually
     * received. Inspections without a paid invoice contribute zero revenue but
     * still count toward inspectionCount.
     */
    async getContactDetail(id: string, tenantId: string) {
        const db = this.getDrizzle();

        const contact = await db.select().from(contacts)
            .where(and(eq(contacts.id, id), eq(contacts.tenantId, tenantId))).get();
        if (!contact) return null;

        // Build the tenant-scoped linkage predicate per contact type.
        let linkage;
        if (contact.type === 'agent') {
            linkage = or(
                eq(inspections.referredByAgentId, id),
                eq(inspections.sellingAgentId, id),
            );
        } else {
            const clientPaths = [eq(inspections.clientContactId, id)];
            if (contact.email) {
                clientPaths.push(eq(inspections.clientEmail, contact.email));
            }
            linkage = clientPaths.length > 1 ? or(...clientPaths) : clientPaths[0];
        }

        const rows = await db.select({
            id:            inspections.id,
            propertyAddress: inspections.propertyAddress,
            date:          inspections.date,
            status:        inspections.status,
            price:         inspections.price,
            paymentStatus: inspections.paymentStatus,
        }).from(inspections)
            .where(and(eq(inspections.tenantId, tenantId), linkage))
            .all();

        // Dedup by inspection id (a row matched by both linkage paths appears
        // once) and order date desc, newest first.
        const seen = new Set<string>();
        const inspectionRows = rows
            .filter(r => (seen.has(r.id) ? false : (seen.add(r.id), true)))
            .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

        const inspectionIds = inspectionRows.map(r => r.id);

        // Revenue = Σ amountCents of PAID invoices on those inspections.
        // Chunk the inArray to stay under D1's 100-bind-param ceiling.
        let totalRevenueCents = 0;
        const CHUNK = 90;
        for (let i = 0; i < inspectionIds.length; i += CHUNK) {
            const chunk = inspectionIds.slice(i, i + CHUNK);
            const res = await db.select({ total: sql<number>`coalesce(sum(${invoices.amountCents}), 0)` })
                .from(invoices)
                .where(and(
                    eq(invoices.tenantId, tenantId),
                    inArray(invoices.inspectionId, chunk),
                    isNotNull(invoices.paidAt),
                    isNull(invoices.voidedAt),
                ))
                .get();
            totalRevenueCents += res?.total ?? 0;
        }

        return {
            contact: {
                id:         contact.id,
                type:       contact.type,
                name:       contact.name,
                email:      contact.email,
                phone:      contact.phone,
                agency:     contact.agency,
                notes:      contact.notes,
                createdAt:  safeISODate(contact.createdAt),
                archivedAt: contact.archivedAt ? safeISODate(contact.archivedAt) : null,
            },
            inspections: inspectionRows.map(r => ({
                id:              r.id,
                propertyAddress: r.propertyAddress,
                date:            r.date,
                status:          r.status,
                price:           r.price,
                paymentStatus:   r.paymentStatus,
            })),
            stats: {
                inspectionCount:   inspectionRows.length,
                totalRevenueCents,
            },
        };
    }

    async createContact(tenantId: string, data: { type: 'agent' | 'client'; name: string; email?: string | null | undefined; phone?: string | null | undefined; agency?: string | null | undefined; notes?: string | null | undefined; createdByUserId?: string | null | undefined }) {
        const db = this.getDrizzle();
        const normalized = {
            email: data.email ?? null,
            phone: data.phone ?? null,
            agency: data.agency ?? null,
            notes: data.notes ?? null,
            // A1 auto-link uses this to populate agent_tenant_links.invited_by_user_id
            // when the agent later signs up with the same email — keeps the
            // /agent-inspectors card pointing at the actual inviting inspector.
            createdByUserId: data.createdByUserId ?? null,
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

    /**
     * IA-1 — Idempotent upsert used during inspection creation to capture client
     * and agent people without double-creating rows.
     *
     * Rules:
     * - Email is normalized to lowercase+trim before any lookup or write.
     * - Email present: find ACTIVE (archived_at IS NULL) row by (tenantId, normalizedEmail).
     *   - Found: fill-forward: set name/phone ONLY where existing value is null/empty. Returns {id, created:false}.
     *   - Not found: INSERT a new row. Returns {id, created:true}.
     * - Email absent: always INSERT a name-only row. Returns {id, created:true}.
     * - Archived rows with matching email are NOT matched (the partial unique allows a fresh active row).
     */
    async upsertClientContact(
        tenantId: string,
        input: { name: string; email?: string; phone?: string; type: 'client' | 'agent' },
    ): Promise<{ id: string; created: boolean }> {
        const db = this.getDrizzle();
        const normalizedEmail = input.email ? input.email.toLowerCase().trim() : undefined;

        if (normalizedEmail) {
            // Look for an ACTIVE row with this email (archived_at IS NULL).
            const existing = await db
                .select()
                .from(contacts)
                .where(
                    and(
                        eq(contacts.tenantId, tenantId),
                        eq(contacts.email, normalizedEmail),
                        isNull(contacts.archivedAt),
                    ),
                )
                .get();

            if (existing) {
                // Fill-forward: only update name/phone if currently null/empty.
                const updates: Partial<{ name: string; phone: string }> = {};
                if ((!existing.name || existing.name.trim() === '') && input.name) {
                    updates.name = input.name;
                }
                if ((!existing.phone || existing.phone.trim() === '') && input.phone) {
                    updates.phone = input.phone;
                }
                if (Object.keys(updates).length > 0) {
                    await db
                        .update(contacts)
                        .set(updates)
                        .where(eq(contacts.id, existing.id));
                }
                return { id: existing.id, created: false };
            }
        }

        // INSERT — either no email or no matching active row found.
        const id = crypto.randomUUID();
        await db.insert(contacts).values({
            id,
            tenantId,
            type: input.type,
            name: input.name,
            email: normalizedEmail ?? null,
            phone: input.phone ?? null,
            agency: null,
            notes: null,
            createdAt: new Date(),
        });
        return { id, created: true };
    }
}
