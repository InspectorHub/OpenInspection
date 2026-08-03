import type { InspectionRoster } from '../inspection/roster';

// Roles that can edit any inspection in the tenant (mirror the editor loader's
// tenant-scoped authorization). Inspector-class users still need assignment.
const ADMIN_ROLES = new Set(['admin', 'manager']);

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
 * nobody outside the admin roles above, which is the right direction for an
 * authorization check.
 */
export function canAccessInspectionCollab(
  roster: InspectionRoster,
  user: { id: string; role: string },
): boolean {
  if (ADMIN_ROLES.has(user.role)) return true;
  return roster.lead?.id === user.id
      || roster.helpers.some((h) => h.id === user.id);
}
