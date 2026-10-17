import { deniedNeedsRole } from '../permission-denied';
import type { UserRole } from '../../types/auth';

/**
 * Only an owner may remove, demote, or promote an owner. `fromRole` is the
 * target's current role and `toRole` the role the call leaves them with (equal
 * to `fromRole` when the role is not moving).
 *
 * The team endpoints are open to managers, so without this a manager could
 * demote or remove an owner, or mint a new one.
 */
export function assertMayTouchOwner(requesterRole: UserRole, fromRole: string, toRole: string): void {
    if (requesterRole === 'owner') return;
    if (fromRole === 'owner' || toRole === 'owner') {
        throw deniedNeedsRole(requesterRole, ['owner'], 'Changing or removing an owner is an owner action');
    }
}
