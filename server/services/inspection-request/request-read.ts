import { and, eq, gte, lte, inArray, desc, type SQL } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import {
    inspectionRequests,
    inspections,
    templates,
    contactRoleProfiles,
    inspectionPeople,
    contacts,
} from '../../lib/db/schema';
import { PRIMARY_CLIENT_KEY } from '../../lib/people/default-role-profiles';
import { safeISODate } from '../../lib/date';

/**
 * READING an inspection request: the joins that assemble a parent plus its
 * children, and the single shape every read returns to the API.
 *
 * Separated from the write side because the two share nothing but the table
 * names. Writing is quota, ownership checks, inserts and the people mirror;
 * reading is one projection, and its correctness rests on one invariant that
 * has nothing to do with writing:
 *
 * CLIENT NAME COMES FROM `inspection_people`, NEVER FROM
 * `inspections.client_name`. That column survives GDPR erasure as a stale
 * denormalized cache, so reading it would leak an erased subject's name. The
 * join is written once here (`selectSubInspections`) rather than twice — it was
 * copied verbatim between `list` and `get`, which is exactly the shape of
 * duplication where one copy gets the next fix.
 *
 * The role filter is joined FIRST so the join does not fan out over every role
 * on a sub-inspection — the same pattern as `api/metrics.ts` and
 * `InspectionCoreService.listInspections`.
 */

export interface ListFilter {
    status?: 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';
    from?:   string;
    to?:     string;
    limit?:  number;
    offset?: number;
}

export type SubInspectionRow = {
    id:              string;
    templateId:      string | null;
    propertyAddress: string;
    clientName:      string | null;
    status:          string;
    date:            string;
    price:           number;
    inspectorId:     string | null;
    requestId:       string | null;
};

export type RequestRow = typeof inspectionRequests.$inferSelect;

/** The client-role projection over `inspections`, narrowed by the caller. */
function selectSubInspections(
    db: DrizzleD1Database,
    tenantId: string,
    narrow: SQL | undefined,
): Promise<SubInspectionRow[]> {
    return db.select({
        id:              inspections.id,
        templateId:      inspections.templateId,
        propertyAddress: inspections.propertyAddress,
        clientName:      contacts.name,
        status:          inspections.status,
        date:            inspections.date,
        price:           inspections.price,
        inspectorId:     inspections.inspectorId,
        requestId:       inspections.requestId,
    }).from(inspections)
        .leftJoin(contactRoleProfiles, and(
            eq(contactRoleProfiles.tenantId, inspections.tenantId),
            eq(contactRoleProfiles.key, PRIMARY_CLIENT_KEY),
            eq(contactRoleProfiles.active, true),
        ))
        .leftJoin(inspectionPeople, and(
            eq(inspectionPeople.roleProfileId, contactRoleProfiles.id),
            eq(inspectionPeople.inspectionId, inspections.id),
            eq(inspectionPeople.tenantId, inspections.tenantId),
        ))
        .leftJoin(contacts, and(
            eq(contacts.id, inspectionPeople.contactId),
            eq(contacts.tenantId, inspections.tenantId),
        ))
        .where(and(eq(inspections.tenantId, tenantId), narrow))
        .all();
}

/**
 * List parent requests for the tenant, eager-loading child inspections.
 * Filters can narrow by status / date window. Pagination is offset-based
 * (offset/limit) — cursor pagination not needed at this scale.
 */
export async function listRequests(db: DrizzleD1Database, tenantId: string, filter: ListFilter = {}) {
    const conds = [eq(inspectionRequests.tenantId, tenantId)];
    if (filter.status) conds.push(eq(inspectionRequests.status, filter.status));
    if (filter.from)   conds.push(gte(inspectionRequests.scheduledAt, new Date(filter.from)));
    if (filter.to)     conds.push(lte(inspectionRequests.scheduledAt, new Date(filter.to)));

    const limit  = filter.limit  ?? 50;
    const offset = filter.offset ?? 0;

    const reqs = await db.select().from(inspectionRequests)
        .where(and(...conds))
        .orderBy(desc(inspectionRequests.scheduledAt))
        .limit(limit)
        .offset(offset)
        .all();

    const reqIds = reqs.map(r => r.id);
    const subRows: SubInspectionRow[] = reqIds.length === 0
        ? []
        : await selectSubInspections(db, tenantId, inArray(inspections.requestId, reqIds));

    return reqs.map(r => shapeRequest(r, subRows.filter(s => s.requestId === r.id)));
}

/**
 * Fetch a single parent request with its children (tenant-scoped).
 * Returns null when not found. Resolves child template names so callers
 * (e.g. the inspection-edit request switcher) can render readable chips
 * without an extra round-trip.
 */
export async function getRequest(db: DrizzleD1Database, tenantId: string, id: string) {
    const req = await db.select().from(inspectionRequests)
        .where(and(eq(inspectionRequests.id, id), eq(inspectionRequests.tenantId, tenantId)))
        .get();
    if (!req) return null;

    const subs = await selectSubInspections(db, tenantId, eq(inspections.requestId, id));

    const tplIds = Array.from(new Set(subs.map(s => s.templateId).filter((x): x is string => !!x)));
    const tplNameById = new Map<string, string>();
    if (tplIds.length > 0) {
        const tplRows = await db.select({ id: templates.id, name: templates.name })
            .from(templates)
            .where(and(eq(templates.tenantId, tenantId), inArray(templates.id, tplIds)))
            .all();
        for (const t of tplRows) tplNameById.set(t.id, t.name);
    }

    return shapeRequest(req, subs, tplNameById);
}

/**
 * The one shape a request read returns. Both entry points go through it, and
 * nothing outside this module may build the shape by hand — which is why it is
 * module-private rather than exported.
 */
function shapeRequest(req: RequestRow, subs: SubInspectionRow[], tplNameById?: Map<string, string>) {
    return {
        id:               req.id,
        tenantId:         req.tenantId,
        clientName:       req.clientName,
        clientEmail:      req.clientEmail,
        clientPhone:      req.clientPhone,
        propertyAddress:  req.propertyAddress,
        propertyCity:     req.propertyCity,
        propertyState:    req.propertyState,
        propertyZip:      req.propertyZip,
        scheduledAt:      safeISODate(req.scheduledAt),
        status:           req.status,
        notes:            req.notes,
        totalAmount:      req.totalAmount,
        paymentStatus:    req.paymentStatus,
        createdAt:        safeISODate(req.createdAt),
        updatedAt:        safeISODate(req.updatedAt),
        inspections:      subs.map(s => ({
            id:              s.id,
            templateId:      s.templateId,
            templateName:    (s.templateId && tplNameById?.get(s.templateId)) || null,
            propertyAddress: s.propertyAddress,
            clientName:      s.clientName,
            status:          s.status,
            date:            s.date,
            price:           s.price,
            inspectorId:     s.inspectorId,
        })),
    };
}
