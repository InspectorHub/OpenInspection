/**
 * The invite door — accepting a team invitation.
 *
 * Split out of `AuthService` because it is the one method that owns a
 * multi-party contract (the acceptance ledger, the seat cap, the portal
 * outbox) rather than a credential operation, and because the class had run
 * past the file-size ceiling with it inside.
 */
import { drizzle } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { users, tenantInvites } from '../../lib/db/schema';
import { buildInviteAcceptanceStatements } from '../legal/invite-acceptance';
import { Errors } from '../../lib/errors';
import { hashPassword } from '../../lib/password';
import { assertSeatAvailableForJoin, type SeatQuotaContext } from '../../features/seat-quota/join-guard';
import type { UserSyncOutbox } from '../../lib/integration/user-sync';

export interface JoinTeamOptions {
    /** Display name the joiner typed on the accept form. */
    name?: string | undefined;
    /**
     * REQUIRED, deliberately. The invite-time guard already exists and is not
     * enough (see tests/unit/tenancy/join-team-seat-guard.spec.ts); an optional
     * parameter here would let the one caller that matters silently opt out of
     * the fix, which is the shape of the bug rather than the shape of a fix.
     */
    seatQuota: SeatQuotaContext;
}

export interface JoinTeamDeps {
    db: D1Database;
    outbox?: UserSyncOutbox | undefined;
}

/**
 * Joins a team using an invitation token.
 *
 * Post-multi-workspace: same email can already exist in another
 * tenant — we only reject when it already exists within THIS tenant.
 * UNIQUE(tenant_id, email) at the DB layer is the hard backstop (the
 * unique index is partial — `WHERE deleted_at IS NULL` — so it only
 * guards active rows).
 *
 * A soft-deleted row for this (tenantId, email) — i.e. a previously
 * removed member (TeamService.removeMember) — is REACTIVATED in place
 * rather than inserted as a new row: `deletedAt` is cleared and the
 * invited role/credentials are applied. This reattaches the member's
 * inspection history under their original id and avoids a UNIQUE(email)
 * conflict with the still-present soft-deleted row.
 *
 * ── The account and its acceptance are ONE write ────────────────────────
 * review A2's invariant, enforced as review review decision requires:
 * the member row and the `account_acceptances` rows go into a single
 * `db.batch()`, D1's only atomic primitive. An acceptance written after the
 * account — even microseconds after, even durably enqueued — leaves the
 * state `account = EXISTS, acceptance_ledger = ABSENT` in between, which is
 * the state the ruling refused.
 *
 * REACTIVATION OWES ONE TOO. It is tempting to treat it as "they already
 * accepted", and the row itself says otherwise: the code below already
 * resets TOTP enrollment because "the invited person accepting this invite
 * may be a different individual than whoever previously held this row". The
 * same sentence answers this question. What is skipped is only the exact
 * `(doc, version)` pairs already on record — see `invite-acceptance.ts`.
 *
 * ⚠️ IT CAN NOW REFUSE. A tenant that has never published its Privacy and
 * Terms has nothing for the invited member to accept, and the join fails
 * rather than creating an account with an empty ledger. Publishing happens
 * when an admin saves that text in Settings, so a workspace that never
 * touched those fields cannot take on members until it does. That is the
 * fail-closed direction and it is a real product consequence, not a
 * theoretical one.
 *
 * ⚠️ IT REFUSES AT THE CAP TOO. `requireSeatAvailable` on POST /team/invite
 * counts ACTIVE members, and a pending invite is not one — so at one free
 * seat that guard says yes to every invite an owner sends, and the seat is
 * only actually taken here. The cap is therefore checked again at the
 * moment it moves, before anything is written, for BOTH branches:
 * reactivation clears `deleted_at`, which is precisely what makes the row
 * countable again.
 */
export async function joinTeam(
    deps: JoinTeamDeps,
    token: string,
    password: string,
    opts: JoinTeamOptions,
) {
    const { name, seatQuota } = opts;
    const db = drizzle(deps.db);
    const invite = await db.select().from(tenantInvites).where(eq(tenantInvites.id, token)).get();

    if (!invite) throw Errors.NotFound('Invalid or expired invitation');
    if (invite.status !== 'pending') throw Errors.BadRequest('Invitation has already been used');
    if (invite.expiresAt < new Date()) throw Errors.BadRequest('Invitation has expired');

    const existing = await db.select().from(users)
        .where(and(eq(users.tenantId, invite.tenantId), eq(users.email, invite.email)))
        .get();
    if (existing && !existing.deletedAt) {
        throw Errors.Conflict('An account with this email already exists in this workspace');
    }

    // Before the hash, before the acceptance statements, before the token
    // is burned — a refusal here must leave the invite reusable once a seat
    // is freed.
    await assertSeatAvailableForJoin(invite.tenantId, deps.db, seatQuota);

    const passwordHash = await hashPassword(password);
    const trimmedName = name?.trim();
    // Settled BEFORE either branch builds its write, and it THROWS when the
    // tenant has published nothing to accept — so the refusal happens while
    // there is still no account to roll back, and neither branch can be
    // half-assembled. The invite is untouched at this point too: a refused
    // join must not burn the token.
    const userId = existing ? existing.id : crypto.randomUUID();
    const { statements: acceptanceStatements, acceptance } = await buildInviteAcceptanceStatements(db, {
        tenantId: invite.tenantId,
        userId,
    });

    // One statement for the member row, then the acceptance rows. The
    // member statement differs by branch; that they travel together does
    // not.
    let memberStatement: BatchItem<'sqlite'>;
    if (existing) {
        memberStatement = db.update(users).set({
            deletedAt: null,
            passwordHash,
            role: invite.role,
            // Carry the inviter's chosen permission-template overrides onto
            // the reactivated row (null when the invite used the pure role
            // template) — replaces whatever the removed member had before.
            permissionOverrides: invite.permissionOverrides ?? null,
            // Reset TOTP enrollment to its never-enrolled defaults (see
            // schema/tenant/user.ts). The invited person accepting this
            // invite may be a different individual than whoever previously
            // held this row — reactivating with the old secret intact
            // would 2FA-challenge them against a code they never set up,
            // with no admin endpoint to disable it. The new occupant
            // re-enrolls 2FA themselves if they want it.
            totpSecret: null,
            totpEnabled: false,
            totpRecoveryCodes: null,
            totpVerifiedAt: null,
            ...(trimmedName ? { name: trimmedName } : {}),
        }).where(eq(users.id, existing.id));
    } else {
        memberStatement = db.insert(users).values({
            id: userId,
            tenantId: invite.tenantId,
            email: invite.email,
            passwordHash,
            role: invite.role,
            // Carry the inviter's chosen permission-template overrides onto the
            // new member row (null when the invite used the pure role template).
            permissionOverrides: invite.permissionOverrides ?? null,
            ...(trimmedName ? { name: trimmedName } : {}),
            createdAt: new Date(),
        });
    }

    // THE one write. No sequential fallback for drivers without `batch` —
    // the fallback would look correct and would reopen exactly the window
    // decision closed.
    await db.batch([memberStatement, ...acceptanceStatements] as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);

    await db.update(tenantInvites).set({ status: 'accepted' }).where(eq(tenantInvites.id, token));

    // Tell portal about the new membership so its `/company/switch`
    // picker shows this company next time the identity signs in. Fires
    // the same way for reactivation as for a brand-new join — the
    // reverse seat sync on the portal side bumps quantity back up either way.
    if (deps.outbox) {
        await deps.outbox.append({
            type: 'user.invited',
            payload: {
                tenantId: invite.tenantId,
                email: invite.email,
                role: invite.role,
                passwordHash,
                // The acceptance rides with the account it belongs to. This
                // event is what creates the portal-side identity and
                // membership, so an event carrying the account WITHOUT the
                // evidence it was validly created teaches the receiving
                // side that the two are separable — which is the belief
                // decision is about. Additive and unparsed on that side
                // today; see `UserSyncAcceptance` for what does and does
                // not consume it.
                acceptance,
            },
        });
    }

    return { id: userId, email: invite.email, tenantId: invite.tenantId, role: invite.role };}
