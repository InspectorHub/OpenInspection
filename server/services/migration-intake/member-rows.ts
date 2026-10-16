import type { migrationRows } from '../../lib/db/schema';
import { TeamService } from '../team.service';
import { isCeilingRefusal, type GrantActor } from '../../lib/auth/grant-ceiling';
import { writeAuditRow } from '../../lib/audit';
import { logger } from '../../lib/logger';
import { asBundleMemberRole, type BundleMember } from '../../lib/migration-intake/bundle';

type StagedRowRecord = typeof migrationRows.$inferSelect;

/**
 * An invite an intake run created. Delivery is the caller's job: a method that
 * both writes rows and sends mail has no consistent retry, and who was written
 * to has to be the same record as what the run reports.
 */
export interface InviteDispatch {
    rowId: string;
    email: string;
    token: string;
    expiresAt: Date;
}

/**
 * A member row becomes an INVITATION, never an account.
 *
 * The person still sets their own password and accepts the workspace's terms at
 * the door, so an import cannot create an account somebody never agreed to.
 *
 * It lives beside the apply service rather than inside it because the seat
 * accounting this path is subject to is a whole-batch rule, decided before any
 * row runs — the two halves are easier to keep honest when the one that writes
 * is the only thing in this file.
 *
 * Throws for exactly ONE reason of its own — a role that is not one an import
 * may grant — and otherwise only from underneath. Either way the caller's
 * per-row catch turns it into a failed row without ending the run.
 */
export async function applyMemberRow(
    db: D1Database,
    params: { tenantId: string; actor?: GrantActor | undefined },
    row: StagedRowRecord,
    invites: InviteDispatch[],
): Promise<
    | { kind: 'applied'; createdId: string; priorState: string | null }
    | { kind: 'skipped'; reason: string }
> {
    const payload = JSON.parse(row.payload) as BundleMember;

    // Members are never overwritten, whatever the policy says. What is mutable
    // on a member is their role and their capability toggles, and changing
    // those is a deliberate act that invalidates the person's session and their
    // outstanding authorisations. An upload may add people; it may not re-grant
    // power.
    if (row.conflictWith) {
        return {
            kind: 'skipped',
            reason: `${payload.email} is already on the team or has an invitation waiting, and was left alone.`,
        };
    }

    // The format carries the role as the FILE spelled it, so it is narrowed
    // here before it can become a grant. The caller has already refused every
    // row the describer objects to — including `agent`, which has its own
    // sentence — so this throw is unreachable through the apply path and is
    // there to keep it that way: a widened value must never reach a grant
    // silently, and the caller's own catch turns it into a failed row.
    const role = asBundleMemberRole(payload.role);
    if (!role) throw new Error(`"${payload.role}" is not a role an import may grant.`);

    // An import is an invitation written on somebody's behalf, so it carries the
    // same ceiling as the Team page: the file cannot grant what the person
    // pressing apply could not. No actor, no grant (fails the row, not the run).
    if (!params.actor) throw new Error('A member import needs to know who is applying it.');

    const team = new TeamService(db);
    let invite: Awaited<ReturnType<TeamService['createInvite']>>;
    try {
        invite = await team.createInvite({
            tenantId: params.tenantId,
            email: payload.email,
            role,
            permissionOverrides: payload.permissionOverrides ?? null,
            actor: params.actor,
        });
    } catch (err) {
        // A refused grant leaves no other trace (nothing was written), and an
        // import is exactly where one is likely: record it like the Team page does.
        if (isCeilingRefusal(err)) await recordRefusal(db, params.tenantId, params.actor.userId, role, err.code);
        throw err;
    }
    invites.push({
        rowId: row.id,
        email: payload.email,
        token: invite.token,
        expiresAt: invite.expiresAt,
    });
    // The token is what an undo cancels, and it is the only handle this row ever
    // holds: no account exists until somebody accepts.
    return { kind: 'applied', createdId: invite.token, priorState: null };
}

/** The durable record of a refused grant. Never fails the row it describes. */
async function recordRefusal(db: D1Database, tenantId: string, userId: string | undefined, role: string, reason: string): Promise<void> {
    try {
        await writeAuditRow({
            db,
            tenantId,
            userId,
            action: 'user.grant_refused',
            entityType: 'user',
            metadata: { reason, role, during: 'import' },
        });
    } catch (e) {
        logger.error('[audit] could not record a refused grant during an import', { tenantId }, e instanceof Error ? e : undefined);
    }
}
