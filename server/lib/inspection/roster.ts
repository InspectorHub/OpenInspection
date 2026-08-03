/**
 * One answer to "who worked this inspection", read through one function.
 *
 * The question has more than one representation in the schema, and the point of
 * this module is that consumers stop choosing between them. It reads
 * `inspection_inspectors` — the link table — and never
 * `inspections.inspector_id`. That is deliberate and it is what the tests pin:
 * a version that falls back to the column would reintroduce the ability for two
 * callers to get two different answers.
 *
 * `inspection_inspectors` is where assignment lives, written by
 * `syncInspectionAssignments` from every assignment write. It carries a ROLE per
 * person and can express more than one of them, which a single column cannot,
 * and anything that attributes work or money to a named person needs both.
 *
 * `inspections.inspector_id` survives only as a fallback for inspections created
 * before this table existed and never re-assigned since. It is not a second
 * authority, and nothing writes it as one.
 *
 * `inspection_events.inspector_id` is NOT part of this. It answers a narrower
 * question — who performed THAT visit — and a radon pickup may legitimately be
 * a different person from the lead. Do not sweep it in.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { inspectionInspectors } from '../db/schema';
import { users } from '../db/schema';

interface RosterMember {
    id: string;
    name: string | null;
    email: string;
}

export interface InspectionRoster {
    /** Null when nobody is assigned. Callers render "unassigned", never throw. */
    lead: RosterMember | null;
    helpers: RosterMember[];
}

const EMPTY: InspectionRoster = { lead: null, helpers: [] };

/**
 * Rosters for many inspections in ONE query.
 *
 * The single-inspection accessor delegates here rather than the other way
 * round: the calendar and the inspections list render many rows at a time, and
 * a per-row accessor would turn one query into N.
 *
 * Returns a Map keyed by inspection id. Ids with no roster are simply absent;
 * `getInspectionRoster` below turns that into the empty roster for the
 * single-inspection case.
 */
export async function getInspectionRosters(
    db: DrizzleD1Database,
    tenantId: string,
    inspectionIds: string[],
): Promise<Map<string, InspectionRoster>> {
    const out = new Map<string, InspectionRoster>();
    if (inspectionIds.length === 0) return out;

    const rows = await db.select({
        inspectionId: inspectionInspectors.inspectionId,
        role:         inspectionInspectors.role,
        userId:       users.id,
        name:         users.name,
        email:        users.email,
    })
        .from(inspectionInspectors)
        .innerJoin(users, eq(users.id, inspectionInspectors.userId))
        .where(and(
            // Tenant scope is on the LINK row, not on the user: an agent user
            // carries a null tenant_id, and scoping on the join would drop
            // rows rather than protect them.
            eq(inspectionInspectors.tenantId, tenantId),
            inArray(inspectionInspectors.inspectionId, inspectionIds),
        ))
        .all();

    for (const r of rows) {
        const entry = out.get(r.inspectionId) ?? { lead: null, helpers: [] };
        const member: RosterMember = { id: r.userId, name: r.name, email: r.email };
        if (r.role === 'lead') entry.lead = member;
        else entry.helpers.push(member);
        out.set(r.inspectionId, entry);
    }
    return out;
}

/** The roster for one inspection. Empty rather than absent when unassigned. */
export async function getInspectionRoster(
    db: DrizzleD1Database,
    tenantId: string,
    inspectionId: string,
): Promise<InspectionRoster> {
    const map = await getInspectionRosters(db, tenantId, [inspectionId]);
    return map.get(inspectionId) ?? EMPTY;
}
