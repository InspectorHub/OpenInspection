/**
 * Resolving the inputs of an agent-placed hold: who the inspector is (if
 * anyone), who reviews it, and what services were asked for.
 *
 * Separate from the concierge state machine because these answer "what did the
 * form mean", not "what state is the booking in" — and because two callers name
 * an inspector two different ways (a booking form knows the user id the company
 * profile publishes; the tenant's own tooling knows the contact id).
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { contacts, users, services as servicesTable, inspectionServices } from '../../lib/db/schema';
import { Errors } from '../../lib/errors';

type Db = DrizzleD1Database<Record<string, never>>;

export interface InspectorRef {
    tenantId: string;
    inspectorUserId?: string;
    inspectorContactId?: string;
}

/**
 * The inspector for a hold, or null when nobody was named — an unassigned hold
 * is the normal case when the agent takes whoever is free. An id that does not
 * belong to this company is a rejection, never a silent unassigned hold.
 */
export async function resolveHoldInspector(db: Db, ref: InspectorRef) {
    if (ref.inspectorUserId) {
        const user = await db
            .select()
            .from(users)
            .where(and(eq(users.id, ref.inspectorUserId), eq(users.tenantId, ref.tenantId)))
            .get();
        if (!user) throw Errors.NotFound('Inspector not found in this company');
        return user;
    }
    if (!ref.inspectorContactId) return null;
    const inspectorContact = await db
        .select()
        .from(contacts)
        .where(and(eq(contacts.id, ref.inspectorContactId), eq(contacts.tenantId, ref.tenantId)))
        .get();
    if (!inspectorContact) throw Errors.NotFound('Inspector contact not found');
    const inspectorEmail = inspectorContact.email ?? '';
    const inspector = inspectorEmail
        ? await db
              .select()
              .from(users)
              .where(and(eq(users.email, inspectorEmail), eq(users.tenantId, ref.tenantId)))
              .get()
        : undefined;
    if (!inspector) throw Errors.NotFound('Inspector user not resolved from contact');
    return inspector;
}

/** The inspector who invited this agent, when the link records one. */
export async function resolveInvitingUser(db: Db, tenantId: string, invitedByUserId: string | null) {
    if (!invitedByUserId) return null;
    return (
        (await db
            .select()
            .from(users)
            .where(and(eq(users.id, invitedByUserId), eq(users.tenantId, tenantId)))
            .get()) ?? null
    );
}

/**
 * Snapshot the services the agent asked for onto the hold and return their
 * total. Snapshots (not references) because the hold quotes what was offered on
 * the day it was placed. An unknown id is an error: a hold that silently drops a
 * service under-quotes the client.
 */
export async function attachHoldServices(
    db: Db,
    tenantId: string,
    inspectionId: string,
    selected: { serviceId: string }[],
): Promise<number> {
    const ids = selected.map((s) => s.serviceId);
    const rows = await db
        .select()
        .from(servicesTable)
        .where(and(eq(servicesTable.tenantId, tenantId), inArray(servicesTable.id, ids)))
        .all();
    if (rows.length !== ids.length) {
        throw Errors.BadRequest('One or more services were not found.');
    }
    await db.insert(inspectionServices).values(
        rows.map((s) => ({
            id: crypto.randomUUID(),
            tenantId,
            inspectionId,
            serviceId: s.id,
            nameSnapshot: s.name,
            priceSnapshot: s.price ?? 0,
        })),
    );
    return rows.reduce((sum, s) => sum + (s.price ?? 0), 0);
}
