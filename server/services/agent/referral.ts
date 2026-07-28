import { drizzle } from 'drizzle-orm/d1';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { tenants, tenantConfigs, users } from '../../lib/db/schema/tenant';
import { contacts } from '../../lib/db/schema/contact';
import { inspections, inspectionResults } from '../../lib/db/schema/inspection';
import { inspectionPeople, contactRoleProfiles } from '../../lib/db/schema';
import { PRIMARY_CLIENT_KEY } from '../../lib/people/default-role-profiles';
import { Errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { REPORT_STATUS } from '../../lib/status/report-status';
import { resolveAgentRepairAccess, type AgentRepairAccess } from '../../lib/people/agent-repair-access';

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
    /** This company's policy for agents on its repair list. */
    repairAccess: AgentRepairAccess;
}

export interface AgentInspectorRow {
    tenantId: string;
    tenantName: string;
    tenantSlug: string;
    contactId: string | null;
    /** The id a booking form names when the agent picks this inspector. */
    inspectorUserId: string | null;
    inspectorName: string | null;
    inspectorPhotoUrl: string | null;
    inspectorSlug: string | null;
}

/*
 * There is no agent↔inspection predicate here any more (IA-104).
 *
 * There used to be: a two-branch filter run in JS after the fetch, comparing
 * the inspection's buyer_agent contact against a pointer on agent_tenant_links
 * and — when that pointer had gone stale — against the agent's email as a
 * string. Both branches existed only because the account binding lived in a
 * separate table that could disagree with the contact it named.
 *
 * The binding is now a column on the contact, so "is this my referral" is
 * answered by the join itself and cannot be skipped, mis-ordered, or applied
 * to one call site and forgotten at another. The email fallback went with it:
 * with nothing to go stale there is nothing for it to rescue. The scenario it
 * covered (a tenant re-adding an archived agent contact) is now handled by the
 * partial unique index, which frees the slot on archive so the new contact can
 * simply be bound.
 */
/**
 * A2 — Cross-tenant referral list. Joins inspections through
 * `agent_tenant_links` (active only) so the agent only sees inspections in
 * tenants they currently have access to. Restricts to inspections that
 * either:
 *   1. Carry a buyer_agent `inspection_people` contactId matching this
 *      agent's contact id in that tenant (canonical link, populated by
 *      inspection create), OR
 *   2. Carry a buyer_agent contact whose email matches the agent user's
 *      email (covers a link left pointing at an archived contact).
 *
 * Single-roundtrip: the buyer_agent contact join IS the access check.
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
            // Whether this company lets agents open / build its repair list;
            // the portal offers only what the API would allow (IA-35).
            inspectionPrefs: tenantConfigs.inspectionPrefs,
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
        })
        .from(inspections)
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
        // IA-104 — THIS join is the whole access check now. The buyer_agent
        // contact carries the agent account binding directly, so "which
        // tenants may I see" and "am I the buyer agent here" are one
        // condition on one row. It replaces a separate agent_tenant_links
        // join, a post-fetch pointer comparison, and an email fallback — all
        // three of which existed only because the binding lived elsewhere.
        // INNER, not LEFT: an inspection whose buyer_agent is not this agent
        // must not appear at all.
        .innerJoin(
            contacts,
            and(
                eq(contacts.id, inspectionPeople.contactId),
                eq(contacts.tenantId, inspections.tenantId),
                eq(contacts.agentUserId, agentUserId),
                isNull(contacts.agentRevokedAt),
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

    // No post-fetch filter and no extra users lookup any more (IA-104): the
    // join answers the association, so every row here is already this agent's.
    return refRows.slice(0, Math.max(0, opts.limit)).map((r) => ({
        id:              r.id,
        tenantId:        r.tenantId,
        tenantName:      r.tenantName,
        tenantSlug: r.tenantSlug,
        tenantTimezone:  r.tenantTimezone ?? 'UTC',
        repairAccess:    resolveAgentRepairAccess(r.inspectionPrefs),
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
        })
        .from(inspections)
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
        // IA-104 — THIS join is the whole access check now. The buyer_agent
        // contact carries the agent account binding directly, so "which
        // tenants may I see" and "am I the buyer agent here" are one
        // condition on one row. It replaces a separate agent_tenant_links
        // join, a post-fetch pointer comparison, and an email fallback — all
        // three of which existed only because the binding lived elsewhere.
        // INNER, not LEFT: an inspection whose buyer_agent is not this agent
        // must not appear at all.
        .innerJoin(
            contacts,
            and(
                eq(contacts.id, inspectionPeople.contactId),
                eq(contacts.tenantId, inspections.tenantId),
                eq(contacts.agentUserId, agentUserId),
                isNull(contacts.agentRevokedAt),
            ),
        )
        .where(eq(inspections.id, inspectionId))
        .all();
    if (rows.length === 0) return null;

    // IA-104 — the join already restricted rows to inspections where THIS
    // agent is the buyer_agent, so the first row is the answer.
    return { tenantId: rows[0]!.tenantId };
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
            tenantName:        tenants.name,
            tenantSlug:        tenants.slug,
            inspectionPrefs:   tenantConfigs.inspectionPrefs,
            propertyAddress:   inspections.propertyAddress,
            date:              inspections.date,
            templateSnapshot:  inspections.templateSnapshot,
            referredById:      inspectionPeople.contactId,
            contactEmail:      contacts.email,
            resultsData:       inspectionResults.data,
        })
        .from(inspections)
        .innerJoin(tenants, eq(tenants.id, inspections.tenantId))
        // Left join: a company with no config row falls back to the policy
        // default in resolveAgentRepairAccess.
        .leftJoin(tenantConfigs, eq(tenantConfigs.tenantId, inspections.tenantId))
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
        // IA-104 — THIS join is the whole access check now. The buyer_agent
        // contact carries the agent account binding directly, so "which
        // tenants may I see" and "am I the buyer agent here" are one
        // condition on one row. It replaces a separate agent_tenant_links
        // join, a post-fetch pointer comparison, and an email fallback — all
        // three of which existed only because the binding lived elsewhere.
        // INNER, not LEFT: an inspection whose buyer_agent is not this agent
        // must not appear at all.
        .innerJoin(
            contacts,
            and(
                eq(contacts.id, inspectionPeople.contactId),
                eq(contacts.tenantId, inspections.tenantId),
                eq(contacts.agentUserId, agentUserId),
                isNull(contacts.agentRevokedAt),
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

    // IA-104 — no post-filter; the join is the access check.
    const flat = rows.flatMap((r) => flattenInspectionToRecommendations({
        id:               r.id,
        tenantName:       r.tenantName,
        tenantSlug:       r.tenantSlug,
        repairAccess:     resolveAgentRepairAccess(r.inspectionPrefs),
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
            tenantId:          contacts.tenantId,
            tenantName:        tenants.name,
            tenantSlug:   tenants.slug,
            contactId:         contacts.id,
            inspectorUserId:   users.id,
            inspectorName:     users.name,
            inspectorPhotoUrl: users.photoUrl,
            inspectorSlug:     users.slug,
        })
        // IA-104 — driven off the contact rows that ARE this agent, instead of
        // a link table pointing at them. `contactId` is now the row's own id
        // rather than a nullable pointer, so it can never disagree.
        //
        // Gated on agent_revoked_at ONLY, deliberately not archived_at:
        // archiving retires a contact from the workspace's own lists, it does
        // not withdraw someone's access to work they were part of. Revoking is
        // the act that does that, and it is separate on purpose — asserted by
        // archived-contact-referral-visibility.spec.
        .from(contacts)
        .innerJoin(tenants, eq(tenants.id, contacts.tenantId))
        // The inspector who brought this agent into the workspace. Was
        // agent_tenant_links.invited_by_user_id, which duplicated this exact
        // fact; the owner-fallback it needed is gone with the link table.
        .leftJoin(users, eq(users.id, contacts.createdByUserId))
        .where(
            and(
                eq(contacts.agentUserId, agentUserId),
                isNull(contacts.agentRevokedAt),
            ),
        )
        .all();
    return rows.map((r) => ({
        tenantId:          r.tenantId,
        tenantName:        r.tenantName,
        tenantSlug:   r.tenantSlug,
        contactId:         r.contactId ?? null,
        inspectorUserId:   r.inspectorUserId ?? null,
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
        })
        .from(inspections)
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
        // IA-104 — the scoping join. This query used to lean on the
        // agent_tenant_links INNER JOIN for tenant scope and then re-check the
        // contact pointer in JS; both collapse into this one condition. It is
        // NOT optional: without it the query counts every inspection in every
        // tenant, because nothing else here mentions the agent.
        .innerJoin(
            contacts,
            and(
                eq(contacts.id, inspectionPeople.contactId),
                eq(contacts.tenantId, inspections.tenantId),
                eq(contacts.agentUserId, agentUserId),
                isNull(contacts.agentRevokedAt),
            ),
        )
        .all();

    const created = new Array<number>(days).fill(0);
    for (const r of rows) {
        // The join already guarantees every row is this agent's referral.
        const cMs = r.createdAt instanceof Date ? r.createdAt.getTime() : Number(r.createdAt) || 0;
        const day = Math.floor((cMs - startMs) / 86400000);
        if (day >= 0 && day < days) created[day]!++;
    }
    return { created };
}

/**
 * Inspector-side revoke of an agent's standing account access. Tenant-scoped:
 * callers pass the tenantId they are acting from (from the JWT) so an id
 * lifted from elsewhere cannot be revoked from a different tenant.
 *
 * IA-104 — `linkId` is now the CONTACT id, since the binding lives on the
 * contact. Stamping `agent_revoked_at` rather than clearing `agent_user_id`
 * keeps the history of who this contact was, and keeps the revoke visible in
 * the UI instead of silently reverting the row to "never had an account".
 *
 * Deliberately does NOT archive the contact: the person is still a real
 * buyer's agent on real inspections and must stay usable there. Only the
 * cross-inspector portal view is withdrawn.
 */
export async function revokeLink(
    rawDb: D1Database,
    linkId: string,
    tenantId: string,
): Promise<void> {
    const db = drizzle(rawDb);
    const row = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(eq(contacts.id, linkId), eq(contacts.tenantId, tenantId)))
        .get();
    if (!row) throw Errors.NotFound('Link not found');
    await db
        .update(contacts)
        .set({ agentRevokedAt: new Date() })
        .where(and(eq(contacts.id, linkId), eq(contacts.tenantId, tenantId)));
    logger.info('agent.link.revoked', { contactId: linkId, tenantId });
}
