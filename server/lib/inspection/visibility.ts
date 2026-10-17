/**
 * Which inspections a person can see.
 *
 * ONE definition, consumed three ways: a condition for a query (`visibleInspectionsCondition`),
 * a sub-select of ids for tables that hang off an inspection (`visibleInspectionIds`), and an
 * assertion for a single id (`assertInspectionVisible`). Nothing else decides this; a route that
 * writes `if (role === 'inspector')` to narrow its data is a second definition waiting to disagree.
 *
 * The rule, within one company:
 *   - An inspection is visible to a user when the user is on its roster: a row in
 *     `inspection_inspectors` as lead OR helper.
 *   - The roster is the authority. `inspections.inspector_id` is a fallback only for an
 *     inspection that has no roster rows at all (created before the roster existed and never
 *     reassigned since). A roster that names someone else wins over a stale column.
 *   - An inspection nobody is assigned to is visible to the administrator tier only.
 *
 * A caller whose scope is 'all' (owner, manager, staff, an unrestricted inspector, and every
 * system path) adds no condition. The scope is a REQUIRED parameter of the service methods that
 * return sets, so forgetting it is a compile error rather than a silent leak.
 */
import { and, eq, exists, inArray, notExists, or, sql, type SQL } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import type { Context } from 'hono';
import { inspections, inspectionInspectors, inspectionPeople } from '../db/schema';
import { contacts } from '../db/schema/contact';
import { Errors } from '../errors';
import { isAdminRole, isRole } from '../auth/roles';
import { capabilitiesFor } from '../middleware/require-capability';
import type { CapabilitySet } from '../auth/capabilities';
import type { HonoConfig } from '../../types/hono';

type DB = Pick<DrizzleD1Database<Record<string, unknown>>, 'select'>;

export type InspectionScope =
    | { readonly kind: 'all' }
    | { readonly kind: 'assigned'; readonly userId: string };

/** Pass this from a path that is not acting for a restricted person (cron, queue, token tracks, the administrator tier). It is greppable on purpose. */
export const ALL_INSPECTIONS: InspectionScope = { kind: 'all' };

function rosterLinks(db: DB, tenantId: string, userId: string | null) {
    return db.select({ one: sql`1` }).from(inspectionInspectors).where(and(
        eq(inspectionInspectors.inspectionId, inspections.id),
        eq(inspectionInspectors.tenantId, tenantId),
        ...(userId === null ? [] : [eq(inspectionInspectors.userId, userId)]),
    ));
}

/** The condition for one user. The outer table must be the unaliased `inspections`. */
function assignedCondition(db: DB, userId: string, tenantId: string): SQL {
    return or(
        exists(rosterLinks(db, tenantId, userId)),
        and(eq(inspections.inspectorId, userId), notExists(rosterLinks(db, tenantId, null))),
    ) as SQL;
}

/** A `where` fragment for a query over `inspections`; undefined for 'all' (and() ignores undefined). */
export function visibleInspectionsCondition(db: DB, scope: InspectionScope, tenantId: string): SQL | undefined {
    return scope.kind === 'all' ? undefined : assignedCondition(db, scope.userId, tenantId);
}

/**
 * For a table keyed by an inspection id: `inArray(table.inspectionId, visibleInspectionIds(...))`.
 * Undefined for 'all'. The sub-select is tenant-bound on both sides.
 */
export function visibleInspectionIds(db: DB, scope: InspectionScope, tenantId: string) {
    if (scope.kind === 'all') return undefined;
    return db.select({ id: inspections.id }).from(inspections)
        .where(and(eq(inspections.tenantId, tenantId), assignedCondition(db, scope.userId, tenantId)));
}

/**
 * Contacts a restricted person can see: the people on their visible inspections, and the contacts
 * they created themselves (so a contact made a moment ago, before it is attached to anything, does
 * not vanish). Undefined for 'all'. The outer table must be the unaliased `contacts`.
 */
export function visibleContactsCondition(db: DB, scope: InspectionScope, tenantId: string): SQL | undefined {
    if (scope.kind === 'all') return undefined;
    const onVisible = db.select({ id: inspectionPeople.contactId }).from(inspectionPeople).where(and(
        eq(inspectionPeople.tenantId, tenantId),
        inArray(inspectionPeople.inspectionId, visibleInspectionIds(db, scope, tenantId)!),
    ));
    return or(inArray(contacts.id, onVisible), eq(contacts.createdByUserId, scope.userId)) as SQL;
}

/**
 * Refuses with 404 when the inspection exists in this company and is not visible. An id that does
 * not exist, or that belongs to another company, passes silently so the caller's own not-found
 * handling answers: the two cases then look the same from outside.
 */
export async function assertInspectionVisible(db: DB, scope: InspectionScope, tenantId: string, inspectionId: string): Promise<void> {
    if (scope.kind === 'all') return;
    const row = await db.select({ visible: sql<number>`(${assignedCondition(db, scope.userId, tenantId)})` })
        .from(inspections)
        .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)))
        .get();
    if (row && !row.visible) throw Errors.NotFound('Inspection not found');
}

/**
 * The path guard's form of the assertion: for a restricted caller, an inspection that does not
 * exist, belongs to another company or is not on the caller's roster all answer the same 404.
 * Use `assertInspectionVisible` instead where the handler follows with its own not-found.
 */
export async function requireVisibleInspection(db: DB, scope: InspectionScope, tenantId: string, inspectionId: string): Promise<void> {
    if (scope.kind === 'all') return;
    const row = await db.select({ visible: sql<number>`(${assignedCondition(db, scope.userId, tenantId)})` })
        .from(inspections)
        .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)))
        .get();
    if (!row || !row.visible) throw Errors.NotFound('Inspection not found');
}

/** The subset of `ids` the scope can see. Batched below D1's bind-parameter ceiling. */
export async function filterVisibleInspectionIds(db: DB, scope: InspectionScope, tenantId: string, ids: string[]): Promise<Set<string>> {
    if (scope.kind === 'all') return new Set(ids);
    const out = new Set<string>();
    for (let i = 0; i < ids.length; i += 50) {
        const rows = await db.select({ id: inspections.id }).from(inspections).where(and(
            eq(inspections.tenantId, tenantId),
            inArray(inspections.id, ids.slice(i, i + 50)),
            assignedCondition(db, scope.userId, tenantId),
        )).all();
        for (const r of rows) out.add(r.id);
    }
    return out;
}

/** Capability set -> scope. Fails closed: anything that lacks the capability is narrowed. */
export function scopeFromCapabilities(userId: string, caps: Pick<CapabilitySet, 'viewAllInspections'>): InspectionScope {
    return caps.viewAllInspections ? ALL_INSPECTIONS : { kind: 'assigned', userId };
}

/**
 * The acting user's scope, resolved from the request (capabilities are read fresh from the
 * database, never from the token) and remembered on the context so a request resolves it once.
 */
export async function resolveInspectionScope(c: Context<HonoConfig>): Promise<InspectionScope> {
    const cached = c.get('inspectionScope');
    if (cached) return cached;
    const role = c.get('userRole');
    const userId = c.get('user')?.sub;
    if (!isRole(role) || !userId) throw Errors.Unauthorized('No identity in context');
    const scope = isAdminRole(role) ? ALL_INSPECTIONS : scopeFromCapabilities(userId, await capabilitiesFor(c));
    c.set('inspectionScope', scope);
    return scope;
}
