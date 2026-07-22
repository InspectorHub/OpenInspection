import { resolvePortalAccess, type PortalAccessResolver } from '../../lib/public-access';
import { PeopleService } from '../people.service';
import { findGlobalAgentById, findGlobalAgentByEmail } from './account';
import { writeAuditLogWithSlug } from '../../lib/audit';
import { Errors } from '../../lib/errors';

/**
 * Agent unified link (Spec 3, Task 2) — the SEPARATE single-use primitive that
 * mints an agent JWT, issued only to a caller who presents a valid, live agent
 * report token for an email that has a global agent account. The durable
 * `inspection_access_tokens` report link (resolved via resolvePortalAccess)
 * grants ONLY report viewing — it never mints a session by itself. This code
 * (KV `agent_ml:<code>`, single-use, 900s TTL) is the only thing that does.
 *
 * Mirrors the `sso:<code>` KV single-use pattern used by the SSO handoff flow
 * (see the `/sso` consumer in server/api/auth.ts): put on issue,
 * get-then-delete-before-use on redeem.
 */

const MAGIC_LOGIN_KV_PREFIX = 'agent_ml:';
const MAGIC_LOGIN_TTL_SECONDS = 900;

interface MagicLoginKvPayload {
    userId: string;
    issuedAt: number;
}

export interface RequestMagicLoginParams {
    portalAccess: PortalAccessResolver;
    kv: KVNamespace;
    db: D1Database;
    inspectionId: string;
    reportToken: string;
    // Absolute origin (protocol + host) the loginUrl is built against — the
    // caller resolves this via getBaseUrl(c) so this module stays Context-free
    // and unit-testable with a plain string.
    coreBaseUrl: string;
}

/**
 * Step 1 of the agent unified link: exchange a live agent report token for a
 * single-use magic-login code, if (and only if) the token's role is
 * agent-kind AND the recipient email has a global agent account.
 *
 * Throws (mapped to 401 by the route) when the report token itself is
 * invalid/revoked/expired/inspection-mismatched, or when it resolves to a
 * non-agent-kind role (e.g. a client link) — those are hard auth failures.
 *
 * Returns the login URL PLUS the agent's account email so the ROUTE can EMAIL
 * the single-use link to that inbox — the link is NEVER returned to the HTTP
 * caller. A durable agent report link is a reusable bearer (often no expiry)
 * sent over email; handing a full-session login URL back to anyone who POSTs it
 * turned a leaked/forwarded report link into full agent-account takeover (#258
 * review #5). Emailing to the account owner means only the agent's inbox can
 * complete sign-in, while report VIEWING via the durable token is unchanged.
 *
 * Returns `null` (NOT an error) when the token is valid and agent-kind but no
 * global agent account exists yet for the recipient email — the route returns
 * the SAME `{ sent: true }` 200 shape (and defers the send to waitUntil) so a
 * caller can't probe report tokens to learn which emails have accounts.
 */
export async function requestMagicLogin(params: RequestMagicLoginParams): Promise<{ loginUrl: string; email: string } | null> {
    const { portalAccess, kv, db, inspectionId, reportToken, coreBaseUrl } = params;

    const grant = await resolvePortalAccess(portalAccess, reportToken, inspectionId);
    if (!grant) {
        throw Errors.Unauthorized('Invalid or expired report link');
    }

    // SECURITY: the grant only carries a role KEY (contact_role_profiles.key).
    // Resolve its `kind` from the ISSUING tenant's role profiles so a client
    // (or 'other') report link can never be used to mint an agent session —
    // grant.tenantId is authoritative here, never the caller-supplied `tenant`.
    const people = new PeopleService({ DB: db });
    const kind = await people.kindForKey(grant.tenantId, grant.role);
    if (kind !== 'agent') {
        throw Errors.Unauthorized('Not an agent report link');
    }

    const account = await findGlobalAgentByEmail(db, grant.recipientEmail);
    const hasAccount = account !== null;

    // Audit the issue attempt regardless of outcome — grant.tenantId is a real
    // tenant row (the inspection's), so this is a legitimate tenant-scoped
    // audit event (unlike the redeem step below, which mints a tenant-less
    // global agent session and is logged structurally instead — see the route).
    await writeAuditLogWithSlug(db, {
        tenantId: grant.tenantId,
        action: 'agent.magic_login.issued',
        entityType: 'agent',
        entityId: inspectionId,
        metadata: { inspectionId, hasAccount },
    });

    if (!account) return null;

    return { loginUrl: await mintLoginCode(kv, account.id, coreBaseUrl), email: account.email };
}

export interface RequestMagicLoginByEmailParams {
    kv: KVNamespace;
    db: D1Database;
    email: string;
    // Absolute origin the loginUrl is built against — same contract as
    // RequestMagicLoginParams.coreBaseUrl above (Context-free, unit-testable).
    coreBaseUrl: string;
}

/**
 * Spec 3 Task 5 — email-only sibling of requestMagicLogin, for the core
 * `/agent-login` page's magic-link fallback (no report token involved, unlike
 * the unified-link flow above). Gated purely on whether the email has a
 * global agent account (findGlobalAgentByEmail — the single shared predicate
 * query in server/services/agent/account.ts, never duplicated here).
 *
 * Returns `null` (NOT an error) when no account exists — the anti-oracle
 * case: the route ALWAYS answers `{ sent: true }` regardless, so a caller
 * can't probe this endpoint to learn which emails have agent accounts.
 */
export async function requestMagicLoginByEmail(params: RequestMagicLoginByEmailParams): Promise<string | null> {
    const { kv, db, email, coreBaseUrl } = params;

    const account = await findGlobalAgentByEmail(db, email);
    if (!account) return null;

    return mintLoginCode(kv, account.id, coreBaseUrl);
}

/**
 * Shared step behind both requestMagicLogin (report-token path) and
 * requestMagicLoginByEmail (email path, Task 5): mint a single-use code in KV
 * for an ALREADY-authorized userId and build the redeemable URL. Does no
 * authorization itself — every caller must establish the account exists
 * (and, for the report-token path, that the token is live and agent-kind)
 * before calling this.
 */
async function mintLoginCode(kv: KVNamespace, userId: string, coreBaseUrl: string): Promise<string> {
    const code = crypto.randomUUID();
    const payload: MagicLoginKvPayload = { userId, issuedAt: Date.now() };
    await kv.put(`${MAGIC_LOGIN_KV_PREFIX}${code}`, JSON.stringify(payload), {
        expirationTtl: MAGIC_LOGIN_TTL_SECONDS,
    });

    return `${coreBaseUrl}/agent/magic-login?code=${code}`;
}

/**
 * Step 2 of the agent unified link: redeem a single-use magic-login code into
 * the agent identity (userId + LIVE email) the route mints a JWT for.
 *
 * Single-use: the KV key is deleted BEFORE the code is parsed/used (mirrors
 * `sso:<code>` in server/api/auth.ts) so a parallel replay of a leaked code
 * can't piggyback on a still-resolving redeem.
 *
 * Re-verifies the account at REDEEM time (not just trusting the issue-time
 * snapshot) — the account may have been deleted or demoted from 'agent'
 * during the 900s TTL window. Mirrors the GET /sso consume handler's own
 * `isNull(users.deletedAt)` re-check.
 *
 * Throws (mapped to a friendly redirect by the route, never a raw 401 JSON)
 * on a missing/expired/malformed code or a since-invalidated account.
 */
export async function redeemMagicLogin(
    kv: KVNamespace,
    db: D1Database,
    code: string,
): Promise<{ userId: string; email: string }> {
    const key = `${MAGIC_LOGIN_KV_PREFIX}${code}`;
    const raw = await kv.get(key);
    await kv.delete(key);
    if (!raw) {
        throw Errors.Unauthorized('Invalid or expired magic-login code');
    }

    let parsed: Partial<MagicLoginKvPayload>;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw Errors.Unauthorized('Invalid or expired magic-login code');
    }
    if (!parsed.userId) {
        throw Errors.Unauthorized('Invalid or expired magic-login code');
    }

    const account = await findGlobalAgentById(db, parsed.userId);
    if (!account) {
        throw Errors.Unauthorized('Agent account no longer available');
    }

    return { userId: account.id, email: account.email };
}
