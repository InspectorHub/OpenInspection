import { eq, and, isNull } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { users } from '../../lib/db/schema';
import { Errors } from '../../lib/errors';

/**
 * Clear a member's two-factor enrolment, so they can sign in with their
 * password alone and enrol again.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────
 * Every other 2FA endpoint is self-service and requires a valid code:
 * `/2fa/disable` and `/2fa/recovery-codes/regenerate` both ask for the
 * current password AND a TOTP or recovery code. That is right for the
 * person who still has their authenticator. It leaves no path at all for
 * the person who does not — an inspector who loses the phone and the
 * recovery codes is locked out of the workspace permanently, and until
 * this method existed nobody in the product could help them.
 *
 * ── WHY OWNER-ONLY ──────────────────────────────────────────────────────
 * This is the one action that lowers another person's authentication
 * requirement, and it is guarded at the route by `requireRole('owner')`
 * rather than by the wider admin tier. A manager can already remove a
 * member; removing is visible and reversible, whereas quietly clearing
 * someone's second factor is neither.
 *
 * ── WHAT IT DOES NOT DO ─────────────────────────────────────────────────
 * It does not touch the password, and it does not sign the member out.
 * Their existing sessions were minted before the reset and stay valid —
 * which is correct: this removes a barrier, it does not respond to a
 * compromise. An owner who believes the account IS compromised removes the
 * member instead, which does invalidate sessions.
 *
 * Refuses on yourself: self-service already covers that case with a code,
 * and an owner who could clear their own second factor from a live session
 * would make 2FA optional for the one account that can never be reduced.
 */
export async function resetMemberTwoFactor(
    db: DrizzleD1Database<Record<string, never>>,
    { tenantId, userId, requesterId }: { tenantId: string; userId: string; requesterId: string },
) {
    if (userId === requesterId) {
        throw Errors.BadRequest(
            'Use Settings → Security to turn off your own two-factor authentication.',
        );
    }
        const member = await db
        .select({ id: users.id, email: users.email, totpEnabled: users.totpEnabled })
        .from(users)
        // Tenant-scoped and alive: an id from another workspace, or one
        // that was removed, must read as "not found" rather than as a
        // successful no-op.
        .where(and(eq(users.id, userId), eq(users.tenantId, tenantId), isNull(users.deletedAt)))
        .get();
    if (!member) throw Errors.NotFound('Member not found');
    if (!member.totpEnabled) {
        // Not silently "successful": an owner pressing this on an account
        // that never had 2FA would otherwise be told the lockout was
        // cleared, and stop looking for the real reason someone cannot
        // sign in.
        throw Errors.BadRequest('This member does not have two-factor authentication enabled.');
    }

    // The same wipe the self-service disable performs, so there is one
    // definition of "enrolled" and no half-cleared state either path can
    // leave behind.
    await db.update(users).set({
        totpSecret: null,
        totpEnabled: false,
        totpRecoveryCodes: null,
        totpVerifiedAt: null,
    }).where(and(eq(users.id, userId), eq(users.tenantId, tenantId)));

    return { email: member.email };
}
