import { drizzle } from 'drizzle-orm/d1';
import { and, desc, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { agentTenantLinks, tenants, tenantConfigs, users } from '../../lib/db/schema/tenant';
import { contacts } from '../../lib/db/schema/contact';
import { inspections, inspectionResults } from '../../lib/db/schema/inspection';
import { inspectionPeople, contactRoleProfiles } from '../../lib/db/schema';
import { PRIMARY_CLIENT_KEY } from '../../lib/people/default-role-profiles';
import { Errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { REPORT_STATUS } from '../../lib/status/report-status';

// Task 9c — the CLIENT role join, aliased so it can coexist in the same query
// as the buyer_agent join (contactRoleProfiles/inspectionPeople/contacts,
// unaliased above) without column/table-name collisions.
const clientRoleProfiles = alias(contactRoleProfiles, 'client_role_profiles');
const clientPeople = alias(inspectionPeople, 'client_people');
const clientContacts = alias(contacts, 'client_contacts');
import {
    flattenInspectionToRecommendations,
    groupRecommendations,
    type AgentRecommendationGroups,
} from '../agent-recommendations';

export interface AgentReferralRow {
    id: string;
    tenantId: string;
    tenantName: string;
    tenantSlug: string;
    /** Owning tenant's display timezone (IANA; 'UTC' when the tenant has no
     *  tenant_configs row or hasn't set default_timezone — same source as the
     *  session-context branding.defaultTimezone). The agent dashboard renders
     *  each referral date in this zone unless the agent set a personal timezone
     *  override (see users.timezone). */
    tenantTimezone: string;
    propertyAddress: string;
    clientName: string | null;
    date: string;
    status: string;
    reportStatus: string | null;
    paymentStatus: string;
    inspectorName: string | null;
}

export interface AgentInspectorRow {
    tenantId: string;
    tenantName: string;
    tenantSlug: string;
    contactId: string | null;
    inspectorName: string | null;
    inspectorPhotoUrl: string | null;
    inspectorSlug: string | null;
}

/**
 * The agent↔inspection association predicate, shared verbatim by listReferrals,
 * accessToInspection, and listRecommendationsForAgent. An agent is associated
 * with a referral row when either:
 *   1. the inspection's buyer_agent `inspection_people` contactId equals the
 *      active link's `inspectorContactId` (canonical link), OR
 *   2. the referred contact's email matches the agent's email (legacy
 *      contacts pre-A1 promotion).
 *
 * Returns a predicate bound to the agent's email so the three call sites stay
 * byte-identical (and the where-condition / row filter stays the same SQL +
 * post-fetch logic across all of them).
 */
function getAgentReferralFilter(
    agentEmail: string | null,
): (r: { referredById: string | null; linkContactId: string | null; contactEmail: string | null }) => boolean {
    return (r) => {
        if (r.referredById && r.linkContactId && r.referredById === r.linkContactId) return true;
        if (agentEmail && r.contactEmail && r.contactEmail.toLowerCase() === agentEmail.toLowerCase()) return true;
        return false;
    };
}

/**
 * A2 — Cross-tenant referral list. Joins inspections through
 * `agent_tenant_links` (active only) so the agent only sees inspections in
 * tenants they currently have access to. Restricts to inspections that
 * either:
 *   1. Carry a buyer_agent `inspection_people` contactId matching this
 *      agent's contact id in that tenant (canonical link, populated by
 *      inspection create), OR
 *   2. Carry a buyer_agent contact whose email matches the agent user's
 *      email (legacy contacts pre-A1 promotion).
 *
 * The compound predicate keeps the query single-roundtrip while remaining
 * resilient to tenants that haven't backfilled `inspectorContactId` on
 * the link row.
 */
export async function listReferrals(
    rawDb: D1Database,
    agentUserId: string,
    opts: { limit: number },
): Promise<AgentReferralRow[]> {
    const db = drizzle(rawDb);
    const refRows = await db
        .select({
            id:              inspections.id,
            tenantId:        inspections.tenantId,
            tenantName:      tenants.name,
            tenantSlug: tenants.slug,
            tenantTimezone:  tenantConfigs.defaultTimezone,
            propertyAddress: inspections.propertyAddress,
            // Task 9c — sourced via the client-role inspection_people join
            // below, NOT the legacy inspections.client_name column (which
            // survives GDPR erasure as a stale denormalized cache and would
            // leak the erased subject's name).
            clientName:      clientContacts.name,
            date:            inspections.date,
            status:          inspections.status,
            reportStatus:    inspections.reportStatus,
            paymentStatus:   inspections.paymentStatus,
            referredById:    inspectionPeople.contactId,
            contactEmail:    contacts.email,
            inspectorName:   users.name,
            linkContactId:   agentTenantLinks.inspectorContactId,
        })
        .from(inspections)
        .innerJoin(
            agentTenantLinks,
            and(
                eq(agentTenantLinks.tenantId, inspections.tenantId),
                eq(agentTenantLinks.agentUserId, agentUserId),
                eq(agentTenantLinks.status, 'active'),
            ),
        )
        .innerJoin(tenants, eq(tenants.id, inspections.tenantId))
        // Owning tenant's display timezone (branding.default_timezone lives on
        // tenant_configs). Left join: tenants without a config row fall back to
        // 'UTC' in the row mapping below.
        .leftJoin(tenantConfigs, eq(tenantConfigs.tenantId, inspections.tenantId))
        // Buyer's-agent attribution: inspections -> contact_role_profiles
        // (this tenant's buyer_agent profile) -> inspection_people -> contacts.
        // contact_role_profiles is joined FIRST (correlated on tenantId only,
        // so it narrows to at most one row per tenant) so the inspection_people
        // join below only ever matches buyer_agent rows — joining
        // inspection_people first would fan out over every role (client,
        // co_client, listing_agent, ...) on the inspection. Replaces the
        // legacy inspections.referredByAgentId column read (see PeopleService).
        .leftJoin(
            contactRoleProfiles,
            and(
                eq(contactRoleProfiles.tenantId, inspections.tenantId),
                eq(contactRoleProfiles.key, 'buyer_agent'),
                eq(contactRoleProfiles.active, true),
            ),
        )
        .leftJoin(
            inspectionPeople,
            and(
                eq(inspectionPeople.roleProfileId, contactRoleProfiles.id),
                eq(inspectionPeople.inspectionId, inspections.id),
                eq(inspectionPeople.tenantId, inspections.tenantId),
            ),
        )
        .leftJoin(
            contacts,
            and(
                eq(contacts.id, inspectionPeople.contactId),
                eq(contacts.tenantId, inspections.tenantId),
            ),
        )
        // Client attribution: inspections -> contact_role_profiles (this
        // tenant's client profile) -> inspection_people -> contacts, aliased
        // to coexist with the buyer_agent join above. Role filter joined
        // FIRST for the same fan-out-avoidance reason as buyer_agent.
        // Replaces the legacy inspections.clientName column read (see
        // PeopleService.getPrimaryClient) — at most one client row per
        // inspection (PeopleService.addPerson enforces this), so no fan-out.
        .leftJoin(
            clientRoleProfiles,
            and(
                eq(clientRoleProfiles.tenantId, inspections.tenantId),
                eq(clientRoleProfiles.key, PRIMARY_CLIENT_KEY),
                eq(clientRoleProfiles.active, true),
            ),
        )
        .leftJoin(
            clientPeople,
            and(
                eq(clientPeople.roleProfileId, clientRoleProfiles.id),
                eq(clientPeople.inspectionId, inspections.id),
                eq(clientPeople.tenantId, inspections.tenantId),
            ),
        )
        .leftJoin(
            clientContacts,
            and(
                eq(clientContacts.id, clientPeople.contactId),
                eq(clientContacts.tenantId, inspections.tenantId),
            ),
        )
        .leftJoin(users, eq(users.id, inspections.inspectorId))
        .orderBy(desc(inspections.date))
        .all();

    // Resolve agent's email once for the legacy fallback predicate.
    const agent = await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, agentUserId))
        .get();
    const agentEmail = agent?.email ?? null;

    // Filter rows in JS — SQLite's join planner doesn't compose the OR
    // predicate (link.contactId == inspection_people's buyer_agent contactId
    // OR contact.email == agentEmail) cleanly when contacts is a left-join.
    // Doing the filter post-fetch is fine: the inner join on links already
    // narrows to ≤ N tenants × inspections, and N is small in practice.
    const filtered = refRows.filter(getAgentReferralFilter(agentEmail));

    return filtered.slice(0, Math.max(0, opts.limit)).map((r) => ({
        id:              r.id,
        tenantId:        r.tenantId,
        tenantName:      r.tenantName,
        tenantSlug: r.tenantSlug,
        tenantTimezone:  r.tenantTimezone ?? 'UTC',
        propertyAddress: r.propertyAddress,
        clientName:      r.clientName ?? null,
        date:            r.date,
        status:          r.status,
        reportStatus:    r.reportStatus ?? null,
        paymentStatus:   r.paymentStatus,
        inspectorName:   r.inspectorName ?? null,
    }));
}

/**
 * Access check for the repair-request builder (and any other per-inspection
 * agent capability). Confirms the signed-in agent is actually associated with
 * the given inspection and returns the inspection's AUTHORITATIVE tenantId
 * (derived from the inspection row, NEVER from a URL segment) so the caller
 * can scope every subsequent query. Returns null when the agent has no claim.
 *
 * Uses the same association predicate as listReferrals:
 *   - active agent_tenant_links row for (agentUserId, inspection.tenantId), AND
 *   - the inspection's buyer_agent inspection_people contactId matches either
 *     the link's inspectorContactId OR a contacts row (type='agent') whose
 *     email equals the agent's email.
 *
 * Single inspection id → at most one tenant; the inner join + filter keeps
 * this O(1) in practice.
 */
export async function accessToInspection(
    rawDb: D1Database,
    agentUserId: string,
    inspectionId: string,
): Promise<{ tenantId: string } | null> {
    const db = drizzle(rawDb);
    const rows = await db
        .select({
            tenantId:      inspections.tenantId,
            referredById:  inspectionPeople.contactId,
            contactEmail:  contacts.email,
            linkContactId: agentTenantLinks.inspectorContactId,
        })
        .from(inspections)
        .innerJoin(
            agentTenantLinks,
            and(
                eq(agentTenantLinks.tenantId, inspections.tenantId),
                eq(agentTenantLinks.agentUserId, agentUserId),
                eq(agentTenantLinks.status, 'active'),
            ),
        )
        // Buyer's-agent attribution via inspection_people — see listReferrals
        // above for why contact_role_profiles is joined before
        // inspection_people (avoids fanning out over every role).
        .leftJoin(
            contactRoleProfiles,
            and(
                eq(contactRoleProfiles.tenantId, inspections.tenantId),
                eq(contactRoleProfiles.key, 'buyer_agent'),
                eq(contactRoleProfiles.active, true),
            ),
        )
        .leftJoin(
            inspectionPeople,
            and(
                eq(inspectionPeople.roleProfileId, contactRoleProfiles.id),
                eq(inspectionPeople.inspectionId, inspections.id),
                eq(inspectionPeople.tenantId, inspections.tenantId),
            ),
        )
        .leftJoin(
            contacts,
            and(
                eq(contacts.id, inspectionPeople.contactId),
                eq(contacts.tenantId, inspections.tenantId),
            ),
        )
        .where(eq(inspections.id, inspectionId))
        .all();
    if (rows.length === 0) return null;

    const agent = await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, agentUserId))
        .get();
    const agentEmail = agent?.email ?? null;

    const match = rows.find(getAgentReferralFilter(agentEmail));
    return match ? { tenantId: match.tenantId } : null;
}

/**
 * UC-A-5 — flatten the agent's referred-and-delivered inspections into a
 * Safety / Recommendation / Maintenance grouped list of defect rows.
 * Reuses the same access predicate as listReferrals (inner join on
 * `agent_tenant_links` + email-fallback for legacy contacts) so an agent
 * cannot cross-tenant snoop or pull recommendations from inspections
 * they didn't refer.
 */
export async function listRecommendationsForAgent(
    rawDb: D1Database,
    agentUserId: string,
): Promise<AgentRecommendationGroups> {
    const db = drizzle(rawDb);
    const rows = await db
        .select({
            id:                inspections.id,
            tenantId:          inspections.tenantId,
            propertyAddress:   inspections.propertyAddress,
            date:              inspections.date,
            templateSnapshot:  inspections.templateSnapshot,
            referredById:      inspectionPeople.contactId,
            contactEmail:      contacts.email,
            linkContactId:     agentTenantLinks.inspectorContactId,
            resultsData:       inspectionResults.data,
        })
        .from(inspections)
        .innerJoin(
            agentTenantLinks,
            and(
                eq(agentTenantLinks.tenantId, inspections.tenantId),
                eq(agentTenantLinks.agentUserId, agentUserId),
                eq(agentTenantLinks.status, 'active'),
            ),
        )
        // Buyer's-agent attribution via inspection_people — see listReferrals
        // above for why contact_role_profiles is joined before
        // inspection_people (avoids fanning out over every role).
        .leftJoin(
            contactRoleProfiles,
            and(
                eq(contactRoleProfiles.tenantId, inspections.tenantId),
                eq(contactRoleProfiles.key, 'buyer_agent'),
                eq(contactRoleProfiles.active, true),
            ),
        )
        .leftJoin(
            inspectionPeople,
            and(
                eq(inspectionPeople.roleProfileId, contactRoleProfiles.id),
                eq(inspectionPeople.inspectionId, inspections.id),
                eq(inspectionPeople.tenantId, inspections.tenantId),
            ),
        )
        .leftJoin(
            contacts,
            and(
                eq(contacts.id, inspectionPeople.contactId),
                eq(contacts.tenantId, inspections.tenantId),
            ),
        )
        .leftJoin(
            inspectionResults,
            and(
                eq(inspectionResults.inspectionId, inspections.id),
                eq(inspectionResults.tenantId, inspections.tenantId),
            ),
        )
        .where(eq(inspections.reportStatus, REPORT_STATUS.PUBLISHED))
        .all();

    const agent = await db.select({ email: users.email })
        .from(users).where(eq(users.id, agentUserId)).get();
    const agentEmail = agent?.email ?? null;

    const filtered = rows.filter(getAgentReferralFilter(agentEmail));

    const flat = filtered.flatMap((r) => flattenInspectionToRecommendations({
        id:               r.id,
        propertyAddress:  r.propertyAddress,
        date:             r.date,
        templateSnapshot: r.templateSnapshot,
        resultsData:      r.resultsData,
    }));
    return groupRecommendations(flat);
}

/**
 * A2 — Inspector directory for an agent. One row per active link with the
 * inviting inspector's display fields (name, photo, slug) joined through
 * `agentTenantLinks.invitedByUserId`. When the link came from auto-link
 * (no inviter), inspector fields fall back to NULL.
 */
export async function listInspectors(
    rawDb: D1Database,
    agentUserId: string,
): Promise<AgentInspectorRow[]> {
    const db = drizzle(rawDb);
    const rows = await db
        .select({
            tenantId:          agentTenantLinks.tenantId,
            tenantName:        tenants.name,
            tenantSlug:   tenants.slug,
            contactId:         agentTenantLinks.inspectorContactId,
            inspectorName:     users.name,
            inspectorPhotoUrl: users.photoUrl,
            inspectorSlug:     users.slug,
        })
        .from(agentTenantLinks)
        .innerJoin(tenants, eq(tenants.id, agentTenantLinks.tenantId))
        .leftJoin(users, eq(users.id, agentTenantLinks.invitedByUserId))
        .where(
            and(
                eq(agentTenantLinks.agentUserId, agentUserId),
                eq(agentTenantLinks.status, 'active'),
            ),
        )
        .all();
    return rows.map((r) => ({
        tenantId:          r.tenantId,
        tenantName:        r.tenantName,
        tenantSlug:   r.tenantSlug,
        contactId:         r.contactId ?? null,
        inspectorName:     r.inspectorName ?? null,
        inspectorPhotoUrl: r.inspectorPhotoUrl ?? null,
        inspectorSlug:     r.inspectorSlug ?? null,
    }));
}

/**
 * A2 — 7-day sparkline data for the 'Active referrals' stat card.
 * Returns an array of `days` integers (default 7). Index 0 is the
 * oldest day (today − days + 1), last index is today.
 *
 * Bucketed in JS because D1 doesn't expose a portable date-bucket
 * function over the `created_at` timestamp column. The fetch is
 * bounded by the agent's active links × inspections per tenant —
 * comfortably small for the dashboard view.
 */
export async function referralsByDay(
    rawDb: D1Database,
    agentUserId: string,
    days = 7,
): Promise<{ created: number[] }> {
    const db = drizzle(rawDb);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const startMs = today.getTime() - (days - 1) * 86400000;

    const rows = await db
        .select({
            createdAt:    inspections.createdAt,
            referredById: inspectionPeople.contactId,
            linkContactId: agentTenantLinks.inspectorContactId,
        })
        .from(inspections)
        .innerJoin(
            agentTenantLinks,
            and(
                eq(agentTenantLinks.tenantId, inspections.tenantId),
                eq(agentTenantLinks.agentUserId, agentUserId),
                eq(agentTenantLinks.status, 'active'),
            ),
        )
        // Buyer's-agent attribution via inspection_people — see listReferrals
        // above for why contact_role_profiles is joined before
        // inspection_people (avoids fanning out over every role). NOTE: if an
        // inspection ever carries more than one buyer_agent inspection_people
        // row for this same agent contact, it would be double-counted here
        // (no downstream dedup, unlike listReferrals' predicate filter) — not
        // possible via the current create paths (single buyer_agent per
        // inspection), flagged for awareness.
        .leftJoin(
            contactRoleProfiles,
            and(
                eq(contactRoleProfiles.tenantId, inspections.tenantId),
                eq(contactRoleProfiles.key, 'buyer_agent'),
                eq(contactRoleProfiles.active, true),
            ),
        )
        .leftJoin(
            inspectionPeople,
            and(
                eq(inspectionPeople.roleProfileId, contactRoleProfiles.id),
                eq(inspectionPeople.inspectionId, inspections.id),
                eq(inspectionPeople.tenantId, inspections.tenantId),
            ),
        )
        .all();

    const created = new Array<number>(days).fill(0);
    for (const r of rows) {
        if (r.referredById && r.linkContactId && r.referredById === r.linkContactId) {
            const cMs = r.createdAt instanceof Date ? r.createdAt.getTime() : Number(r.createdAt) || 0;
            const day = Math.floor((cMs - startMs) / 86400000);
            if (day >= 0 && day < days) created[day]!++;
        }
    }
    return { created };
}

/**
 * A2 — Inspector-side revoke of a partner link. Tenant-scoped: callers
 * must pass the tenantId they're acting from (from the JWT) so a stolen
 * linkId can't be revoked from a different tenant.
 */
export async function revokeLink(
    rawDb: D1Database,
    linkId: string,
    tenantId: string,
): Promise<void> {
    const db = drizzle(rawDb);
    const row = await db
        .select({ id: agentTenantLinks.id })
        .from(agentTenantLinks)
        .where(and(eq(agentTenantLinks.id, linkId), eq(agentTenantLinks.tenantId, tenantId)))
        .get();
    if (!row) throw Errors.NotFound('Link not found');
    await db
        .update(agentTenantLinks)
        .set({ status: 'revoked', revokedAt: new Date() })
        .where(and(eq(agentTenantLinks.id, linkId), eq(agentTenantLinks.tenantId, tenantId)));
    logger.info('agent.link.revoked', { linkId, tenantId });
}
