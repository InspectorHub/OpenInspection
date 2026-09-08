import type { Role } from '../auth/roles';
import type { InspectionRoster } from '../inspection/roster';

// Roles that can edit any inspection in the tenant (mirror the editor loader's
// tenant-scoped authorization). Inspector-class users still need assignment.
// ⚠️ `owner`, not `admin`. This set read `{'admin', 'manager'}`, and this
// product has no `admin` role at all — `ROLES` is
// `owner | manager | inspector | agent`. So half of it matched nobody, and the
// OWNER fell through to the roster and was refused on every inspection they had
// not personally been assigned to: the highest role in the workspace could not
// open the collaborative editor.
//
// Spelled by importing the vocabulary rather than by retyping it, because the
// spec that covered this was green the whole time — it asserted `role: 'admin'`
// was allowed, which agreed with the bug and with nothing else.
const ELEVATED_ROLES: ReadonlySet<Role> = new Set<Role>(['owner', 'manager']);

/**
 * May this user edit this inspection collaboratively?
 *
 * Reads the ROSTER, not `inspections.lead_inspector_id` / `helper_inspector_ids`.
 * Those two columns are NULL and `'[]'` on every production row, so this check
 * was effectively "are you inspections.inspector_id" while claiming to honour a
 * lead and a helper list. The first write of either would have made collab
 * access disagree with every other answer to "who works this inspection" — and
 * disagreeing about who may EDIT is the worst place to discover that.
 *
 * Fails closed by construction: an inspection with no roster grants access to
 * nobody outside the elevated roles above, which is the right direction for an
 * authorization check.
 */
export function canAccessInspectionCollab(
  roster: InspectionRoster,
  user: { id: string; role: string },
): boolean {
  if (ELEVATED_ROLES.has(user.role as Role)) return true;
  return roster.lead?.id === user.id
      || roster.helpers.some((h) => h.id === user.id);
}
