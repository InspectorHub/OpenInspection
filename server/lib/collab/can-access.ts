// Roles that can edit any inspection in the tenant (mirror the editor loader's
// tenant-scoped authorization). Inspector-class users still need assignment.
const ADMIN_ROLES = new Set(['admin', 'manager']);

export function canAccessInspectionCollab(
  inspection: { inspectorId: string | null; leadInspectorId: string | null; helperInspectorIds: string | null },
  user: { id: string; role: string },
): boolean {
  if (ADMIN_ROLES.has(user.role)) return true;
  let helpers: string[] = [];
  try {
    const p = JSON.parse(inspection.helperInspectorIds ?? '[]');
    if (Array.isArray(p)) helpers = p as string[];
  } catch { /* malformed — treat as no helpers */ }
  return inspection.inspectorId === user.id
      || inspection.leadInspectorId === user.id
      || helpers.includes(user.id);
}
