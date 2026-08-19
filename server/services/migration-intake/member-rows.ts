import type { migrationRows } from '../../lib/db/schema';
import { TeamService } from '../team.service';
import type { BundleMember } from '../../lib/migration-intake/bundle';

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
 * Never throws for a reason of its own: a row that cannot be written throws
 * from underneath, and the caller's per-row catch is what turns that into a
 * failed row without ending the run.
 */
export async function applyMemberRow(
    db: D1Database,
    params: { tenantId: string },
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

    const team = new TeamService(db);
    const invite = await team.createInvite({
        tenantId: params.tenantId,
        email: payload.email,
        role: payload.role,
        permissionOverrides: payload.permissionOverrides ?? null,
    });
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
