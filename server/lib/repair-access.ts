/**
 * Repair-builder access resolution.
 *
 * Resolves tenantId + Creator from the same three modes as the public report
 * route (portal token → legacy agent KV token → owner-preview JWT), returning
 * null when none succeed.
 *
 * Extracted from server/api/repair-builder.ts (pure movement).
 */

import type { Context } from 'hono';
import { resolvePortalAccess, resolveOwnerPreviewFull, resolveAgentSession } from './public-access';
import { hashToken } from './token-hash';
import type { Creator } from '../services/repair-request.service';
import type { HonoConfig } from '../types/hono';

/**
 * The `creator.ref` a legacy KV share link owns its lists under.
 *
 * ── WHY NOT THE TOKEN ITSELF ───────────────────────────────────────────────
 * It used to be the raw token. `created_by_ref` is a durable D1 column that
 * the inspector portal's repair log renders verbatim, so a live 30-day report
 * credential was sitting in the database in plaintext and on a staff screen.
 *
 * ── WHY NOT A STABLE AGENT IDENTITY, WHICH WOULD BE BETTER ─────────────────
 * Because there is none to resolve on this path, and that is a property of the
 * token rather than a gap in the code. `generateAgentViewToken` mints one token
 * per (tenant, INSPECTION) and stores `{inspectionId}:{tenantId}` under it —
 * no person is named anywhere in the record — and the link is designed to be
 * forwarded, so it is not even one-to-one with an agent. The agent-session path
 * below can use `userId` precisely because a session names a user; a share link
 * does not. Nothing here can be upgraded into an identity without asking the
 * holder who they are, which this path exists to avoid.
 *
 * ── WHY NOT A CONSTANT "AN AGENT WE COULD NOT IDENTIFY" MARKER ─────────────
 * Because `listMine` and `assertCanEdit` key ownership on
 * (tenantId, inspectionId, createdByKind, createdByRef). Collapsing every
 * legacy link to one ref would give two agents holding DIFFERENT links to the
 * same inspection read AND write over each other's lists — widening access
 * while fixing a disclosure. Honest about identity, wrong about authorization.
 *
 * ── SO: THE DIGEST, AND WHAT IT IS AND IS NOT ──────────────────────────────
 * SHA-256 of the token keeps exactly today's ownership boundary — one share
 * link, one owner — while what lands in D1 cannot be replayed: presenting the
 * digest at `?token=` resolves nothing in KV. It does NOT identify the agent
 * and must not be read as doing so; the `legacy-share:` prefix says that on
 * sight, and also keeps the value from ever being mistaken for the email the
 * portal-token path writes into this same column (see the erasure manifest,
 * which matches that column against a subject's address).
 *
 * Unkeyed, deliberately, rather than an HMAC: the token is 128 bits of
 * crypto-random, so there is no guessable-input problem a key would solve, and
 * an unkeyed digest survives key rotation — the same live link has to keep
 * resolving to the same owner across one.
 */
async function legacyShareLinkRef(token: string): Promise<string> {
    return `legacy-share:${await hashToken(token)}`;
}

/**
 * Resolves tenantId + Creator from the same three modes as the public report
 * route (portal token → legacy agent KV token → owner-preview JWT), returning
 * null when none succeed.
 *
 * creator.ref semantics:
 *   client    → recipientEmail (stable per-recipient identifier from the token row)
 *   agent     → recipientEmail on the portal-token path; the agent's stable
 *               userId when authenticated via a logged-in agent-portal session
 *               JWT; `legacy-share:<sha256>` on the legacy KV share-link path,
 *               which names the LINK and not a person (see legacyShareLinkRef)
 *   inspector → userId from the verified owner-preview JWT
 *
 * ⚠️ Rows written before the digest landed hold the raw token in
 * `created_by_ref`. Nothing breaks — every reader takes the column as an opaque
 * string — but such a row still carries the credential, and its owner no longer
 * matches it, so returning on the same link starts a fresh list instead of
 * reopening the old one. One pass over `created_by_kind = 'agent'` rows whose
 * ref is bare 64-hex (an email has an `@`, a userId has dashes), rewriting each
 * to `legacy-share:` + its own digest, closes both at once and is idempotent
 * under the prefix check. Not done here: it is a data migration, not a code path.
 */
/** Whether the resolved actor may read only, or read and write. */
export type BuilderAccessLevel = 'read' | 'readwrite';

export async function resolveBuilderAccess(
    c: Context<HonoConfig>,
    id: string,
): Promise<{ tenantId: string; creator: Creator; ownerPreview: boolean; accessLevel: BuilderAccessLevel } | null> {
    const token = c.req.query('token');

    // Whether/how an agent may act on the repair list is a tenant policy
    // (IA-35 / IA-73): off → no access at all, read → view only (writes 403),
    // readwrite → full. Both agent tracks (portal token and agent session) go
    // through here, so they can never disagree. client / inspector actors are
    // always readwrite.
    const agentLevel = async (tenantId: string): Promise<BuilderAccessLevel | null> => {
        const setting = await c.var.services.inspection.getAgentRepairAccess(tenantId);
        return setting === 'off' ? null : setting;
    };

    // Path 1: persistent portal token. The grant's role kind decides the actor —
    // assuming 'client' for every resolvable token let an agent-kind token
    // (buyer_agent / listing_agent) act as the client on the builder's five
    // write endpoints (IA-35), exactly what the sibling client-actor resolver
    // guards against. client/co_client → client; agent → agent; anything else
    // (attorney, title company, …) has no builder role → reject.
    const grant = await resolvePortalAccess(c.var.services.portalAccess, token, id);
    if (grant) {
        const kind = await c.var.services.portalAccess.getRoleKind(grant.tenantId, grant.role);
        if (kind === 'client') {
            return { tenantId: grant.tenantId, creator: { kind: 'client', ref: grant.recipientEmail }, ownerPreview: false, accessLevel: 'readwrite' };
        }
        if (kind === 'agent') {
            const accessLevel = await agentLevel(grant.tenantId);
            if (!accessLevel) return null;
            return { tenantId: grant.tenantId, creator: { kind: 'agent', ref: grant.recipientEmail }, ownerPreview: false, accessLevel };
        }
        return null;
    }

    // Path 2: legacy KV agent-view token (existing share links).
    if (token) {
        const legacy = await c.var.services.inspection.resolveAgentViewToken(token);
        if (legacy && legacy.inspectionId === id) {
            const accessLevel = await agentLevel(legacy.tenantId);
            if (!accessLevel) return null;
            // NEVER `ref: token` — see legacyShareLinkRef above for why this is
            // a digest and not the token, an identity, or a constant marker.
            return { tenantId: legacy.tenantId, creator: { kind: 'agent', ref: await legacyShareLinkRef(token) }, ownerPreview: false, accessLevel };
        }
    }

    // Path 3: owner-preview via session Bearer JWT (tenant user / inspector).
    const ownerFull = await resolveOwnerPreviewFull(c);
    if (ownerFull) {
        return { tenantId: ownerFull.tenantId, creator: { kind: 'inspector', ref: ownerFull.userId }, ownerPreview: true, accessLevel: 'readwrite' };
    }

    // Path 4: logged-in agent-portal session JWT (tokenless dashboard link).
    // The agent JWT classifies as kind:'agent' and carries NO tenantId, so it is
    // rejected by owner-preview above. Verify the session, then confirm the agent
    // is actually associated with THIS inspection — deriving the tenantId from the
    // inspection row, never from the URL `:tenant` segment.
    const agentSession = await resolveAgentSession(c);
    if (agentSession) {
        const assoc = await c.var.services.agent.accessToInspection(agentSession.userId, id);
        if (assoc) {
            const accessLevel = await agentLevel(assoc.tenantId);
            if (!accessLevel) return null;
            return { tenantId: assoc.tenantId, creator: { kind: 'agent', ref: agentSession.userId }, ownerPreview: false, accessLevel };
        }
    }

    return null;
}
