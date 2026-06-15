import { drizzle } from 'drizzle-orm/d1';
import { and, desc, eq, ne } from 'drizzle-orm';
import { isNull } from 'drizzle-orm';
import { agentInvites, agentTenantLinks, tenants, users } from '../lib/db/schema/tenant';
import { contacts } from '../lib/db/schema/contact';
import { inspections, inspectionResults } from '../lib/db/schema/inspection';
import { Errors } from '../lib/errors';
import { logger } from '../lib/logger';
import { REPORT_STATUS } from '../lib/status/report-status';
import { hashPassword } from '../lib/password';
import type { EmailService } from './email.service';
import {
    flattenInspectionToRecommendations,
    groupRecommendations,
    type AgentRecommendationGroups,
} from './agent-recommendations';

export interface AgentReferralRow {
    id: string;
    tenantId: string;
    tenantName: string;
    tenantSlug: string;
    propertyAddress: string;
    clientName: string | null;
    date: string;
    status: string;
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

export interface AgentProfilePatch {
    slug?: string;
    notifyOnReferral?: boolean;
    notifyOnReport?: boolean;
    notifyOnPaid?: boolean;
    name?: string;
}

export interface ResolvedInvite {
    token: string;
    email: string;
    tenantId: string;
    tenantName: string;
    inspector: { id: string; name: string };
    inviterEmail: string | null;
    expired: boolean;
    used: boolean;
}

export interface AcceptInviteInput {
    password: string;
    name: string;
    termsAccepted?: { at: string; ip?: string; country?: string; termsUrl?: string; privacyUrl?: string };
}

export interface AcceptInviteResult {
    userId: string;
    email: string;
    name: string;
    tenantId: string; // the invite's tenant — caller can redirect into that scope
}

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
 */

const INVITE_TOKEN_BYTES = 24; // 24 bytes -> 48 hex chars
const INVITE_TTL_DAYS = 7;

function mintToken(): string {
    const buf = new Uint8Array(INVITE_TOKEN_BYTES);
    crypto.getRandomValues(buf);
    let hex = '';
    for (const b of buf) hex += b.toString(16).padStart(2, '0');
    return hex;
}

function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

export class AgentService {
    constructor(
        private db: D1Database,
        private email: EmailService,
        private appBaseUrl: string,
    ) {}

    private getDrizzle() {
        return drizzle(this.db);
    }

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
        const db = this.getDrizzle();
        const email = normalizeEmail(params.email);

        // Look up tenant + inspector to populate the email body.
        const tenant = await db
            .select({ id: tenants.id, name: tenants.name })
            .from(tenants)
            .where(eq(tenants.id, tenantId))
            .get();
        if (!tenant) throw Errors.NotFound('Tenant not found');

        const inspector = await db
            .select({ id: users.id, name: users.name, email: users.email })
            .from(users)
            .where(eq(users.id, invitedByUserId))
            .get();
        if (!inspector) throw Errors.NotFound('Inspector not found');

        // Reject duplicate pending invite (same tenant + email + not yet accepted + not expired).
        const nowMs = Date.now();
        const existing = await db
            .select({ token: agentInvites.token, expiresAt: agentInvites.expiresAt })
            .from(agentInvites)
            .where(
                and(
                    eq(agentInvites.tenantId, tenantId),
                    eq(agentInvites.email, email),
                    isNull(agentInvites.acceptedAt),
                ),
            )
            .all();
        const stillValid = existing.find((row) => {
            const exp = row.expiresAt instanceof Date ? row.expiresAt.getTime() : Number(row.expiresAt);
            return exp > nowMs;
        });
        if (stillValid) {
            throw Errors.Conflict('An invite is already pending for this email');
        }

        const token = mintToken();
        const expiresAt = new Date(nowMs + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
        const row = {
            token,
            tenantId,
            inspectorContactId: params.contactId ?? null,
            email,
            invitedByUserId,
            expiresAt,
            acceptedAt: null,
            createdAt: new Date(),
        };
        await db.insert(agentInvites).values(row);

        const acceptUrl = `${this.appBaseUrl.replace(/\/$/, '')}/agent-invite/accept?token=${encodeURIComponent(token)}`;
        let emailSent = false;
        try {
            await this.email.sendAgentInvite(email, {
                token,
                inspectorName: inspector.name ?? inspector.email ?? 'an inspector',
                tenantName: tenant.name,
                acceptUrl,
            });
            emailSent = true;
        } catch (err) {
            // Surface the token to the inspector even if email delivery flakes — they can
            // copy + paste the accept link manually. Production-ready alternative would
            // queue a retry; A1 keeps it simple.
            logger.warn('agent.invite.email.failed', {
                tenantId,
                email,
                error: err instanceof Error ? err.message : String(err),
            });
        }

        return {
            token,
            expiresAt: Math.floor(expiresAt.getTime() / 1000),
            emailSent,
        };
    }

    /**
     * Resolve an invite token into the metadata the public accept page needs:
     * inspector name + photo + tenant name + expiry status. Returns null when
     * no invite row matches the token; surfaces `expired=true` for tokens past
     * their TTL so the caller can render the friendly recovery page.
     */
    async resolveInvite(token: string): Promise<ResolvedInvite | null> {
        const db = this.getDrizzle();
        const row = await db
            .select({
                token: agentInvites.token,
                email: agentInvites.email,
                tenantId: agentInvites.tenantId,
                expiresAt: agentInvites.expiresAt,
                acceptedAt: agentInvites.acceptedAt,
                invitedByUserId: agentInvites.invitedByUserId,
                tenantName: tenants.name,
                inspectorName: users.name,
                inspectorEmail: users.email,
            })
            .from(agentInvites)
            .innerJoin(tenants, eq(tenants.id, agentInvites.tenantId))
            .innerJoin(users, eq(users.id, agentInvites.invitedByUserId))
            .where(eq(agentInvites.token, token))
            .get();
        if (!row) return null;

        const exp = row.expiresAt instanceof Date ? row.expiresAt.getTime() : Number(row.expiresAt);
        const expired = exp <= Date.now();
        const used = row.acceptedAt !== null && row.acceptedAt !== undefined;
        return {
            token: row.token,
            email: row.email,
            tenantId: row.tenantId,
            tenantName: row.tenantName,
            inspector: {
                id: row.invitedByUserId,
                name: row.inspectorName ?? row.inspectorEmail ?? 'an inspector',
            },
            inviterEmail: row.inspectorEmail ?? null,
            expired,
            used,
        };
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
        const db = this.getDrizzle();

        const invite = await db
            .select()
            .from(agentInvites)
            .where(eq(agentInvites.token, token))
            .get();
        if (!invite) throw Errors.NotFound('Invite not found');
        if (invite.acceptedAt) throw Errors.Conflict('Invite has already been used');
        const exp = invite.expiresAt instanceof Date ? invite.expiresAt.getTime() : Number(invite.expiresAt);
        if (exp <= Date.now()) throw Errors.BadRequest('Invite has expired');

        const email = invite.email; // already lowercased on invite()

        // Reuse existing global user when one already exists (e.g. self-signed up
        // earlier). Otherwise mint a fresh agent user.
        let agent = await db
            .select({ id: users.id, name: users.name, email: users.email, role: users.role, tenantId: users.tenantId })
            .from(users)
            .where(eq(users.email, email))
            .get();

        if (!agent) {
            const id = crypto.randomUUID();
            const passwordHash = await hashPassword(input.password);
            await db.insert(users).values({
                id,
                tenantId: null,
                email,
                passwordHash,
                name: input.name,
                role: 'agent',
                createdAt: new Date(),
                termsAccepted: input.termsAccepted ?? null,
            });
            agent = { id, name: input.name, email, role: 'agent', tenantId: null };
        } else if (agent.role !== 'agent') {
            // Email already belongs to an inspector / owner / admin — block to avoid
            // accidentally promoting a tenant user to a global agent.
            throw Errors.Conflict('An account with this email already exists. Please log in instead.');
        }

        // Create the explicit link from the invite. Idempotent via the unique index.
        try {
            await db.insert(agentTenantLinks).values({
                id: crypto.randomUUID(),
                agentUserId: agent.id,
                tenantId: invite.tenantId,
                inspectorContactId: invite.inspectorContactId ?? null,
                status: 'active',
                invitedByUserId: invite.invitedByUserId,
                createdAt: new Date(),
            });
        } catch {
            // Already linked — fine, proceed.
        }

        // Fold in any other tenants where this email already exists as a contact
        // with type='agent'. Reconciles the invite-driven and self-signup paths.
        await this.autoLinkSameEmail(agent.id, email);

        await db
            .update(agentInvites)
            .set({ acceptedAt: new Date() })
            .where(eq(agentInvites.token, token));

        return {
            userId: agent.id,
            email,
            name: agent.name ?? input.name,
            tenantId: invite.tenantId,
        };
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
        const db = this.getDrizzle();
        const email = normalizeEmail(input.email);

        const existing = await db
            .select({ id: users.id, role: users.role })
            .from(users)
            .where(eq(users.email, email))
            .get();
        if (existing) {
            throw Errors.Conflict('An account with this email already exists');
        }

        const id = crypto.randomUUID();
        const passwordHash = await hashPassword(input.password);
        await db.insert(users).values({
            id,
            tenantId: null,
            email,
            passwordHash,
            name: input.name,
            role: 'agent',
            createdAt: new Date(),
            termsAccepted: input.termsAccepted ?? null,
        });

        await this.autoLinkSameEmail(id, email);
        return { userId: id, email };
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
        const db = this.getDrizzle();
        const normalized = normalizeEmail(email);
        const matches = await db
            .select({
                id: contacts.id,
                tenantId: contacts.tenantId,
                createdByUserId: contacts.createdByUserId,
            })
            .from(contacts)
            .where(and(eq(contacts.email, normalized), eq(contacts.type, 'agent')))
            .all();

        let created = 0;
        for (const row of matches) {
            try {
                // Use contact.createdByUserId as the inviting inspector when present
                // so /agent-inspectors can render the inspector's name + slug. When
                // the contact predates this column or was imported in bulk, fall
                // back to the tenant owner so the auto-linked card still shows a
                // real person instead of a generic tenant-only stub.
                let invitedByUserId: string | null = row.createdByUserId ?? null;
                if (!invitedByUserId) {
                    const owner = await db
                        .select({ id: users.id })
                        .from(users)
                        .where(and(eq(users.tenantId, row.tenantId), eq(users.role, 'owner')))
                        .get();
                    invitedByUserId = owner?.id ?? null;
                }
                await db.insert(agentTenantLinks).values({
                    id: crypto.randomUUID(),
                    agentUserId: userId,
                    tenantId: row.tenantId,
                    inspectorContactId: row.id,
                    status: 'active',
                    invitedByUserId,
                    createdAt: new Date(),
                });
                created++;
            } catch {
                // unique-index violation (already linked) — skip silently.
            }
        }
        logger.info('agent.autolink', { userId, email: normalized, count: created });
        return created;
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
        const db = this.getDrizzle();
        const refRows = await db
            .select({
                id:              inspections.id,
                tenantId:        inspections.tenantId,
                tenantName:      tenants.name,
                tenantSlug: tenants.slug,
                propertyAddress: inspections.propertyAddress,
                clientName:      inspections.clientName,
                date:            inspections.date,
                status:          inspections.status,
                paymentStatus:   inspections.paymentStatus,
                referredById:    inspections.referredByAgentId,
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
            .leftJoin(
                contacts,
                and(
                    eq(contacts.id, inspections.referredByAgentId),
                    eq(contacts.tenantId, inspections.tenantId),
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
        // predicate (link.contactId == inspection.referredByAgentId OR
        // contact.email == agentEmail) cleanly when contacts is a left-join.
        // Doing the filter post-fetch is fine: the inner join on links already
        // narrows to ≤ N tenants × inspections, and N is small in practice.
        const filtered = refRows.filter((r) => {
            if (r.referredById && r.linkContactId && r.referredById === r.linkContactId) return true;
            if (agentEmail && r.contactEmail && r.contactEmail.toLowerCase() === agentEmail.toLowerCase()) return true;
            return false;
        });

        return filtered.slice(0, Math.max(0, opts.limit)).map((r) => ({
            id:              r.id,
            tenantId:        r.tenantId,
            tenantName:      r.tenantName,
            tenantSlug: r.tenantSlug,
            propertyAddress: r.propertyAddress,
            clientName:      r.clientName ?? null,
            date:            r.date,
            status:          r.status,
            paymentStatus:   r.paymentStatus,
            inspectorName:   r.inspectorName ?? null,
        }));
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
        const db = this.getDrizzle();
        const rows = await db
            .select({
                id:                inspections.id,
                tenantId:          inspections.tenantId,
                propertyAddress:   inspections.propertyAddress,
                date:              inspections.date,
                templateSnapshot:  inspections.templateSnapshot,
                referredById:      inspections.referredByAgentId,
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
            .leftJoin(
                contacts,
                and(
                    eq(contacts.id, inspections.referredByAgentId),
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

        const filtered = rows.filter((r) => {
            if (r.referredById && r.linkContactId && r.referredById === r.linkContactId) return true;
            if (agentEmail && r.contactEmail && r.contactEmail.toLowerCase() === agentEmail.toLowerCase()) return true;
            return false;
        });

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
    async listInspectors(agentUserId: string): Promise<AgentInspectorRow[]> {
        const db = this.getDrizzle();
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
    async referralsByDay(agentUserId: string, days = 7): Promise<{ created: number[] }> {
        const db = this.getDrizzle();
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        const startMs = today.getTime() - (days - 1) * 86400000;

        const rows = await db
            .select({
                createdAt:    inspections.createdAt,
                referredById: inspections.referredByAgentId,
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
    async revokeLink(linkId: string, tenantId: string): Promise<void> {
        const db = this.getDrizzle();
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

    /**
     * A2 — Persist agent profile patches (slug + 3 notification toggles + name).
     * Slug uniqueness is enforced across global agent users only — agent slugs
     * live in a separate namespace from per-tenant inspector slugs because
     * agent users have `tenantId IS NULL`.
     */
    async updateProfile(userId: string, patch: AgentProfilePatch): Promise<void> {
        const db = this.getDrizzle();
        if (patch.slug !== undefined) {
            const candidate = patch.slug.trim().toLowerCase();
            if (!candidate) throw Errors.BadRequest('Slug must not be empty');
            const taken = await db
                .select({ id: users.id })
                .from(users)
                .where(
                    and(
                        eq(users.slug, candidate),
                        isNull(users.tenantId),
                        eq(users.role, 'agent'),
                        ne(users.id, userId),
                    ),
                )
                .get();
            if (taken) throw Errors.Conflict('Slug already taken');
        }

        const set: Record<string, unknown> = {};
        if (patch.slug !== undefined) set.slug = patch.slug.trim().toLowerCase();
        if (patch.notifyOnReferral !== undefined) set.notifyOnReferral = patch.notifyOnReferral;
        if (patch.notifyOnReport !== undefined) set.notifyOnReport = patch.notifyOnReport;
        if (patch.notifyOnPaid !== undefined) set.notifyOnPaid = patch.notifyOnPaid;
        if (patch.name !== undefined) set.name = patch.name;
        if (Object.keys(set).length === 0) return;

        await db.update(users).set(set).where(eq(users.id, userId));
        logger.info('agent.profile.updated', { userId, fields: Object.keys(set) });
    }
}
