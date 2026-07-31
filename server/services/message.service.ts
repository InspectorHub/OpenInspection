import { drizzle } from 'drizzle-orm/d1';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { inspectionMessages, inspections, inspectionPeople, contactRoleProfiles, contacts } from '../lib/db/schema';
import type { MessageAttachment } from '../lib/db/schema';
import { Errors } from '../lib/errors';
import type { NotificationService } from './notification.service';
import { PeopleService } from './people.service';

interface CreateMessageInput {
    tenantId: string;
    inspectionId: string | null;
    /** The counterparty whose thread this message belongs to — never the staff author. */
    contactId: string;
    fromRole: 'inspector' | 'client' | 'agent' | 'other';
    /** Staff author when fromRole === 'inspector'; null when the counterparty sent it. */
    fromUserId?: string | null;
    fromName?: string | null;
    body: string;
    attachments: MessageAttachment[];
}

/** The counterparty a portal actor's messages belong to. */
export interface ThreadContact {
    contactId: string;
    name: string | null;
    email: string | null;
}

export class MessageService {
    constructor(private d1: D1Database, private notification?: NotificationService) {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private db() { return drizzle(this.d1 as any); }

    async createMessage(input: CreateMessageInput) {
        const id = crypto.randomUUID();
        const now = new Date();
        await this.db().insert(inspectionMessages).values({
            id,
            tenantId: input.tenantId,
            inspectionId: input.inspectionId,
            contactId: input.contactId,
            fromRole: input.fromRole,
            fromUserId: input.fromUserId ?? null,
            fromName: input.fromName ?? null,
            body: input.body,
            attachments: input.attachments,
            readAt: null,
            createdAt: now,
        });
        const [row] = await this.db().select().from(inspectionMessages).where(eq(inspectionMessages.id, id)).limit(1);
        if (!row) throw Errors.Internal('Failed to create message');

        // B3: in-app notification — when a counterparty posts, alert the
        // inspector who owns this inspection. Staff-originated messages don't
        // fire (the contact receives them via email separately).
        if (this.notification && input.fromRole !== 'inspector' && input.inspectionId) {
            const insp = await this.db().select({ inspectorId: inspections.inspectorId, address: inspections.propertyAddress })
                .from(inspections)
                .where(and(eq(inspections.id, input.inspectionId), eq(inspections.tenantId, input.tenantId)))
                .get();
            if (insp?.inspectorId) {
                await this.notification.create({
                    tenantId: input.tenantId,
                    userId: insp.inspectorId,
                    type: 'message.received',
                    title: `New message from ${input.fromName ?? 'client'}`,
                    body: input.body.length > 120 ? input.body.slice(0, 117) + '...' : input.body,
                    entityType: 'inspection',
                    entityId: input.inspectionId,
                    metadata: { address: insp.address ?? null },
                });
            }
        }

        return row;
    }

    /**
     * Company-wide inbox: one row per contact thread (design §3.9 — the
     * Conversations shape both competitors ship). `WHERE contact_id` is the
     * whole query once threads are contact-keyed; this summarises it per
     * contact: who, their newest message, and how many counterparty rows are
     * unread. Ordered newest-activity first.
     */
    async listThreads(tenantId: string): Promise<Array<{
        contactId: string;
        contactName: string | null;
        contactEmail: string | null;
        lastBody: string;
        lastFromRole: string;
        lastAt: number;
        unread: number;
    }>> {
        const rows = await this.db().select({
            contactId: inspectionMessages.contactId,
            lastAt: sql<number>`max(${inspectionMessages.createdAt})`,
            unread: sql<number>`sum(case when ${inspectionMessages.fromRole} != 'inspector' and ${inspectionMessages.readAt} is null then 1 else 0 end)`,
            contactName: contacts.name,
            contactEmail: contacts.email,
        })
            .from(inspectionMessages)
            .leftJoin(contacts, and(eq(contacts.id, inspectionMessages.contactId), eq(contacts.tenantId, inspectionMessages.tenantId)))
            .where(eq(inspectionMessages.tenantId, tenantId))
            .groupBy(inspectionMessages.contactId)
            .orderBy(sql`max(${inspectionMessages.createdAt}) desc`);

        // Second pass for each thread's newest body — a correlated subquery in
        // the same select would be per-dialect fragile; thread counts are small
        // (bounded by the tenant's contact list), so one IN query is fine.
        const latest = new Map<string, { body: string; fromRole: string }>();
        if (rows.length > 0) {
            const all = await this.db().select({
                contactId: inspectionMessages.contactId,
                body: inspectionMessages.body,
                fromRole: inspectionMessages.fromRole,
                createdAt: inspectionMessages.createdAt,
            })
                .from(inspectionMessages)
                .where(eq(inspectionMessages.tenantId, tenantId))
                .orderBy(inspectionMessages.createdAt);
            for (const r of all) latest.set(r.contactId, { body: r.body, fromRole: r.fromRole });
        }

        return rows.map((r) => ({
            contactId: r.contactId,
            contactName: r.contactName ?? null,
            contactEmail: r.contactEmail ?? null,
            lastBody: latest.get(r.contactId)?.body ?? '',
            lastFromRole: latest.get(r.contactId)?.fromRole ?? 'client',
            lastAt: typeof r.lastAt === 'object' && r.lastAt !== null ? (r.lastAt as unknown as Date).getTime() : Number(r.lastAt),
            unread: Number(r.unread ?? 0),
        }));
    }

    /**
     * One contact's full thread, across every inspection AND the rows with no
     * inspection at all (pre-booking outreach) — the per-inspection query
     * filters those out by construction, so this is the only reader that sees
     * them. Inspection addresses ride along so a mention renders as a link
     * with a human label.
     */
    async listThreadForContact(tenantId: string, contactId: string) {
        const rows = await this.db().select({
            msg: inspectionMessages,
            propertyAddress: inspections.propertyAddress,
        })
            .from(inspectionMessages)
            .leftJoin(inspections, and(
                eq(inspections.id, inspectionMessages.inspectionId),
                eq(inspections.tenantId, inspectionMessages.tenantId),
            ))
            .where(and(eq(inspectionMessages.tenantId, tenantId), eq(inspectionMessages.contactId, contactId)))
            .orderBy(inspectionMessages.createdAt);
        return rows.map((r) => ({ ...r.msg, propertyAddress: r.propertyAddress ?? null }));
    }

    /** Mark one contact's counterparty-authored rows read (staff opened the thread). */
    async markContactThreadReadForStaff(tenantId: string, contactId: string) {
        await this.db().update(inspectionMessages)
            .set({ readAt: new Date() })
            .where(and(
                eq(inspectionMessages.tenantId, tenantId),
                eq(inspectionMessages.contactId, contactId),
                ne(inspectionMessages.fromRole, 'inspector'),
                isNull(inspectionMessages.readAt),
            ));
    }

    /** A contact's basic identity, tenant-scoped (compose header + send). */
    async contactById(tenantId: string, contactId: string): Promise<ThreadContact | null> {
        const row = await this.db().select({ contactId: contacts.id, name: contacts.name, email: contacts.email })
            .from(contacts)
            .where(and(eq(contacts.id, contactId), eq(contacts.tenantId, tenantId)))
            .get();
        return row ?? null;
    }

    async listForInspection(inspectionId: string, tenantId: string) {
        return this.db().select().from(inspectionMessages)
            .where(and(eq(inspectionMessages.inspectionId, inspectionId), eq(inspectionMessages.tenantId, tenantId)))
            .orderBy(inspectionMessages.createdAt);
    }

    /**
     * Mark counterparty-authored messages read across a whole inspection — the
     * inspector opened the merged view. "Counterparty" is anything not
     * `inspector`: the old `fromRole = 'client'` filter would leave agent and
     * other rows permanently unread once those roles start posting
     * (feedback_audit_downstream_filters_when_adding_fields).
     */
    async markInspectionReadForStaff(inspectionId: string, tenantId: string) {
        await this.db().update(inspectionMessages)
            .set({ readAt: new Date() })
            .where(and(
                eq(inspectionMessages.inspectionId, inspectionId),
                eq(inspectionMessages.tenantId, tenantId),
                ne(inspectionMessages.fromRole, 'inspector'),
                isNull(inspectionMessages.readAt),
            ));
    }

    /**
     * Mark staff-authored messages read within ONE contact's thread — a portal
     * viewer opened THEIR thread. Keyed by contact, not inspection: under
     * per-contact threading an inspection-wide mark would let one viewer clear
     * unread state on every other participant's thread.
     */
    async markThreadReadForContact(tenantId: string, contactId: string, inspectionId: string) {
        await this.db().update(inspectionMessages)
            .set({ readAt: new Date() })
            .where(and(
                eq(inspectionMessages.tenantId, tenantId),
                eq(inspectionMessages.contactId, contactId),
                eq(inspectionMessages.inspectionId, inspectionId),
                eq(inspectionMessages.fromRole, 'inspector'),
                isNull(inspectionMessages.readAt),
            ));
    }

    /** Unread counterparty-authored messages across the tenant (sidebar badge). */
    async unreadCountForTenant(tenantId: string): Promise<number> {
        const [row] = await this.db().select({ c: sql<number>`count(*)` })
            .from(inspectionMessages)
            .where(and(
                eq(inspectionMessages.tenantId, tenantId),
                ne(inspectionMessages.fromRole, 'inspector'),
                isNull(inspectionMessages.readAt),
            ));
        return Number(row?.c ?? 0);
    }

    /**
     * Resolve which contact's thread a portal actor writes into — THEIR OWN
     * seat on the inspection, matched by the verified email the actor
     * authenticated with. This is what fixes the co-client attribution bug: a
     * co-client's message used to be signed with the primary client's name
     * because attribution went through getPrimaryClient unconditionally.
     * Falls back to the primary client when no seat matches the email (a
     * grant issued to an address that was later edited on the contact).
     */
    async resolveThreadContact(tenantId: string, inspectionId: string, actorEmail?: string | null): Promise<ThreadContact | null> {
        if (actorEmail) {
            const seat = await this.db().select({ contactId: contacts.id, name: contacts.name, email: contacts.email })
                .from(inspectionPeople)
                .innerJoin(contacts, eq(inspectionPeople.contactId, contacts.id))
                .where(and(
                    eq(inspectionPeople.tenantId, tenantId),
                    eq(inspectionPeople.inspectionId, inspectionId),
                    sql`lower(${contacts.email}) = lower(${actorEmail})`,
                ))
                .get();
            if (seat) return seat;
        }
        return this.primaryClientThread(tenantId, inspectionId);
    }

    /**
     * The primary client's thread — where an inspector's reply goes when no
     * explicit thread is named (the pre-picker send surface). Kept distinct
     * from resolveThreadContact so call sites read as what they mean.
     */
    async primaryClientThread(tenantId: string, inspectionId: string): Promise<ThreadContact | null> {
        const primary = await new PeopleService({ DB: this.d1 }).getPrimaryClient(tenantId, inspectionId);
        return primary ? { contactId: primary.contactId, name: primary.name, email: primary.email } : null;
    }

    /**
     * A named contact's seat on this inspection, for an explicit-thread send
     * (the compose contact picker). Returns null when the contact is not on the
     * inspection — a send may not invent a thread with a stranger.
     */
    async contactOnInspection(tenantId: string, inspectionId: string, contactId: string): Promise<ThreadContact | null> {
        const seat = await this.db().select({ contactId: contacts.id, name: contacts.name, email: contacts.email })
            .from(inspectionPeople)
            .innerJoin(contacts, eq(inspectionPeople.contactId, contacts.id))
            .where(and(
                eq(inspectionPeople.tenantId, tenantId),
                eq(inspectionPeople.inspectionId, inspectionId),
                eq(inspectionPeople.contactId, contactId),
            ))
            .get();
        return seat ?? null;
    }

    /**
     * The role kind a contact holds on this inspection, for stamping fromRole
     * on counterparty-authored rows. 'other' when the seat's profile has no
     * recognisable kind.
     */
    async roleKindOnInspection(tenantId: string, inspectionId: string, contactId: string): Promise<'client' | 'agent' | 'other'> {
        const seat = await this.db().select({ kind: contactRoleProfiles.kind })
            .from(inspectionPeople)
            .innerJoin(contactRoleProfiles, eq(inspectionPeople.roleProfileId, contactRoleProfiles.id))
            .where(and(
                eq(inspectionPeople.tenantId, tenantId),
                eq(inspectionPeople.inspectionId, inspectionId),
                eq(inspectionPeople.contactId, contactId),
            ))
            .get();
        const kind = seat?.kind;
        return kind === 'client' || kind === 'agent' ? kind : 'other';
    }

    /**
     * Resolves the inspection's primary-client display name (for attribution on
     * client-authored messages), via the inspection_people join
     * (PeopleService.getPrimaryClient) rather than the legacy
     * inspections.clientName column (dropped, Task 13). Null when the
     * inspection has no primary client. Tenant-scoped.
     */
    async clientNameForInspection(inspectionId: string, tenantId: string): Promise<string | null> {
        const client = await new PeopleService({ DB: this.d1 }).getPrimaryClient(tenantId, inspectionId);
        return client?.name ?? null;
    }

    /**
     * Resolves the inspection's primary-client email (for building the portal
     * message-notification deep-link), via the inspection_people join
     * (PeopleService.getPrimaryClient) rather than the legacy
     * inspections.clientEmail column (dropped, Task 13). Null when missing.
     * Tenant-scoped.
     */
    async clientEmailForInspection(inspectionId: string, tenantId: string): Promise<string | null> {
        const client = await new PeopleService({ DB: this.d1 }).getPrimaryClient(tenantId, inspectionId);
        return client?.email ?? null;
    }

    /**
     * Resolves a single message attachment scoped by INSPECTION (tenant + id),
     * keyed by the inspection id the caller is already authorized for (JWT
     * inspector or resolveClientActor client). Returns the stored attachment
     * metadata only when the attachment belongs to a message on this inspection
     * — never exposing arbitrary R2 keys. Returns null when no such attachment
     * exists.
     */
    async resolveAttachmentForInspection(
        inspectionId: string,
        tenantId: string,
        attachmentId: string,
    ): Promise<{ key: string; name: string; type: string } | null> {
        if (!attachmentId) return null;
        const rows = await this.listForInspection(inspectionId, tenantId);
        for (const row of rows) {
            for (const att of row.attachments ?? []) {
                if (att.id === attachmentId) {
                    return { key: att.key, name: att.name, type: att.type };
                }
            }
        }
        return null;
    }
}
