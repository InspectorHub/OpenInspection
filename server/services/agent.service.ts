import type { EmailService } from './email.service';
import type { AgentRecommendationGroups } from './agent-recommendations';
import {
    listReferrals,
    accessToInspection,
    listRecommendationsForAgent,
    listInspectors,
    referralsByDay,
    revokeLink,
    type AgentReferralRow,
    type AgentInspectorRow,
} from './agent/referral';
import {
    invite,
    resolveInvite,
    acceptInvite,
    type ResolvedInvite,
    type AcceptInviteInput,
    type AcceptInviteResult,
} from './agent/invite';
import { signup, autoLinkSameEmail } from './agent/signup';
import { updateProfile, type AgentProfilePatch } from './agent/profile';

export type { AgentReferralRow, AgentInspectorRow } from './agent/referral';
export type { ResolvedInvite, AcceptInviteInput, AcceptInviteResult } from './agent/invite';
export type { AgentProfilePatch } from './agent/profile';
export { getAgentReferralFilter } from './agent/referral';

/**
 * Agent Accounts A1 — invites, accepts, signups, and the same-email auto-link
 * routine that reconciles invite-driven and self-signup paths.
 *
 * Agents are global users (users.tenant_id IS NULL, role='agent') that connect
 * to one or more tenants via rows in `agent_tenant_links`. The mental model:
 *
 *   - Inspector at tenant A invites jane@realty.com
 *     -> agent_invites row (TTL 7d)
 *     -> Jane clicks /agent-invite/accept?token=… and sets a password
 *     -> users row (tenant_id NULL, role=agent) + agent_tenant_links row
 *
 *   - Jane self-signs-up at /agent-signup
 *     -> users row (tenant_id NULL, role=agent)
 *     -> autoLinkSameEmail() finds every contacts row where email=Jane's and
 *        type='agent' and creates an active agent_tenant_links row for each.
 *
 * The implementation is split into domain modules under `server/services/agent/`
 * (invite / signup / referral / profile); this class stays the public facade so
 * `services.agent.X(...)` call sites + tests remain unchanged.
 */
export class AgentService {
    constructor(
        private db: D1Database,
        private email: EmailService,
        private appBaseUrl: string,
    ) {}

    /**
     * Mint an invite token + persist the invite + send the agent-invite email.
     * Rejects when an unaccepted, non-expired invite for the same email already
     * exists for this tenant — duplicate prevention is per-tenant, so two
     * different tenants can independently invite the same email.
     */
    async invite(
        tenantId: string,
        invitedByUserId: string,
        params: { email: string; contactId?: string },
    ): Promise<{ token: string; expiresAt: number; emailSent: boolean }> {
        return invite(this.db, this.email, this.appBaseUrl, tenantId, invitedByUserId, params);
    }

    /**
     * Resolve an invite token into the metadata the public accept page needs:
     * inspector name + photo + tenant name + expiry status. Returns null when
     * no invite row matches the token; surfaces `expired=true` for tokens past
     * their TTL so the caller can render the friendly recovery page.
     */
    async resolveInvite(token: string): Promise<ResolvedInvite | null> {
        return resolveInvite(this.db, token);
    }

    /**
     * Accept an invite: validate token, create or reuse a global agent user,
     * link them to the invite's tenant, run the same-email auto-link routine
     * to fold in any other tenants that already had this email as a contact,
     * and mark the invite consumed.
     *
     * Throws on expired / already-used / unknown tokens.
     */
    async acceptInvite(token: string, input: AcceptInviteInput): Promise<AcceptInviteResult> {
        return acceptInvite(this.db, token, input);
    }

    /**
     * Self-serve signup: create a global agent user, run autoLinkSameEmail to
     * surface every tenant that already had this email as a contact, return
     * the user id. Conflict (existing email) -> 409 with loginUrl hint.
     */
    async signup(input: {
        email: string;
        password: string;
        name: string;
        termsAccepted?: { at: string; ip?: string; country?: string; termsUrl?: string; privacyUrl?: string };
    }): Promise<{ userId: string; email: string }> {
        return signup(this.db, input);
    }

    /**
     * Same-email auto-link: when an agent account is created (signup or invite-accept),
     * find every `contacts` row in any tenant where `type='agent'` and `email` matches
     * the agent's email, and create an `active` agent_tenant_links row for each. Skips
     * existing links thanks to the unique (agent_user_id, tenant_id) index.
     *
     * Returns the count of new links created (idempotent — second call returns 0).
     */
    async autoLinkSameEmail(userId: string, email: string): Promise<number> {
        return autoLinkSameEmail(this.db, userId, email);
    }

    /**
     * A2 — Cross-tenant referral list. Joins inspections through
     * `agent_tenant_links` (active only) so the agent only sees inspections in
     * tenants they currently have access to. Restricts to inspections that
     * either:
     *   1. Carry a `referredByAgentId` matching this agent's contact id in
     *      that tenant (canonical link, populated by inspection create), OR
     *   2. Carry a `referredByAgentId` whose contact email matches the agent
     *      user's email (legacy contacts pre-A1 promotion).
     *
     * The compound predicate keeps the query single-roundtrip while remaining
     * resilient to tenants that haven't backfilled `inspectorContactId` on
     * the link row.
     */
    async listReferrals(
        agentUserId: string,
        opts: { limit: number },
    ): Promise<AgentReferralRow[]> {
        return listReferrals(this.db, agentUserId, opts);
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
     *   - inspection.referredByAgentId matches either the link's inspectorContactId
     *     OR a contacts row (type='agent') whose email equals the agent's email.
     *
     * Single inspection id → at most one tenant; the inner join + filter keeps
     * this O(1) in practice.
     */
    async accessToInspection(
        agentUserId: string,
        inspectionId: string,
    ): Promise<{ tenantId: string } | null> {
        return accessToInspection(this.db, agentUserId, inspectionId);
    }

    /**
     * UC-A-5 — flatten the agent's referred-and-delivered inspections into a
     * Safety / Recommendation / Maintenance grouped list of defect rows.
     * Reuses the same access predicate as listReferrals (inner join on
     * `agent_tenant_links` + email-fallback for legacy contacts) so an agent
     * cannot cross-tenant snoop or pull recommendations from inspections
     * they didn't refer.
     */
    async listRecommendationsForAgent(
        agentUserId: string,
    ): Promise<AgentRecommendationGroups> {
        return listRecommendationsForAgent(this.db, agentUserId);
    }

    /**
     * A2 — Inspector directory for an agent. One row per active link with the
     * inviting inspector's display fields (name, photo, slug) joined through
     * `agentTenantLinks.invitedByUserId`. When the link came from auto-link
     * (no inviter), inspector fields fall back to NULL.
     */
    async listInspectors(agentUserId: string): Promise<AgentInspectorRow[]> {
        return listInspectors(this.db, agentUserId);
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
    async referralsByDay(agentUserId: string, days = 7): Promise<{ created: number[] }> {
        return referralsByDay(this.db, agentUserId, days);
    }

    /**
     * A2 — Inspector-side revoke of a partner link. Tenant-scoped: callers
     * must pass the tenantId they're acting from (from the JWT) so a stolen
     * linkId can't be revoked from a different tenant.
     */
    async revokeLink(linkId: string, tenantId: string): Promise<void> {
        return revokeLink(this.db, linkId, tenantId);
    }

    /**
     * A2 — Persist agent profile patches (slug + 3 notification toggles + name).
     * Slug uniqueness is enforced across global agent users only — agent slugs
     * live in a separate namespace from per-tenant inspector slugs because
     * agent users have `tenantId IS NULL`.
     */
    async updateProfile(userId: string, patch: AgentProfilePatch): Promise<void> {
        return updateProfile(this.db, userId, patch);
    }
}
