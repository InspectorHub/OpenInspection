import { drizzle } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import { isNull } from 'drizzle-orm';
import { agentInvites, agentTenantLinks, tenants, users } from '../../lib/db/schema/tenant';
import { Errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { hashPassword } from '../../lib/password';
import type { EmailService } from '../email.service';
import { INVITE_TTL_DAYS, mintToken, normalizeEmail } from './shared';
import { autoLinkSameEmail } from './signup';

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
 * Mint an invite token + persist the invite + send the agent-invite email.
 * Rejects when an unaccepted, non-expired invite for the same email already
 * exists for this tenant — duplicate prevention is per-tenant, so two
 * different tenants can independently invite the same email.
 */
export async function invite(
    rawDb: D1Database,
    email: EmailService,
    appBaseUrl: string,
    tenantId: string,
    invitedByUserId: string,
    params: { email: string; contactId?: string },
): Promise<{ token: string; expiresAt: number; emailSent: boolean }> {
    const db = drizzle(rawDb);
    const emailAddr = normalizeEmail(params.email);

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
                eq(agentInvites.email, emailAddr),
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
        email: emailAddr,
        invitedByUserId,
        expiresAt,
        acceptedAt: null,
        createdAt: new Date(),
    };
    await db.insert(agentInvites).values(row);

    const acceptUrl = `${appBaseUrl.replace(/\/$/, '')}/agent-invite/accept?token=${encodeURIComponent(token)}`;
    let emailSent = false;
    try {
        await email.sendAgentInvite(emailAddr, {
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
            email: emailAddr,
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
export async function resolveInvite(
    rawDb: D1Database,
    token: string,
): Promise<ResolvedInvite | null> {
    const db = drizzle(rawDb);
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
export async function acceptInvite(
    rawDb: D1Database,
    token: string,
    input: AcceptInviteInput,
): Promise<AcceptInviteResult> {
    const db = drizzle(rawDb);

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
    await autoLinkSameEmail(rawDb, agent.id, email);

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
