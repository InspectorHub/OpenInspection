import { ROLE, isAdminRole } from '../auth/roles';

/**
 * Design System 0520 subsystem C phase 4 — canEdit permission matrix.
 *
 * Pure decision function answering "is this user allowed to mutate this
 * inspection?".
 *
 * ⚠️ NOTHING IN PRODUCTION CALLS THIS. Write-bearing routes authorize with
 * `requireRole` + `requireCapability` only — a role/capability test, with no
 * per-inspection membership check. So the policy below ("an inspector may edit
 * an inspection they are on") is NOT currently enforced: within a tenant, any
 * inspector with the capability may edit any inspection. That may well be the
 * intended product behaviour; it is recorded here because the docstring used to
 * claim this function guarded every write, and it does not.
 *
 * Role outcomes:
 *   - owner / admin  → always true
 *   - inspector      → true when caller is on the inspection
 *   - agent          → false (buyer-agent view is read-only)
 */

export interface CanEditUser {
    id:                 string;
    role:               string;
    // Legacy field kept for back-compat with existing callers. Section-scope
    // edit restrictions were removed when the specialist role was collapsed
    // into a plain inspector (2026-06-13) — this is no longer consulted.
    assignedSectionIds: string;   // JSON-encoded string array
}

export interface CanEditInspection {
    id:              string;
    /**
     * Everyone on the inspection, by user id — the roster's lead and helpers
     * (`getInspectionRoster`), plus `inspections.inspector_id` for rows created
     * before that table existed and never re-assigned since.
     *
     * Membership is passed in rather than read from `inspections` because the
     * lead and helper columns are no longer written; reading them would make
     * this function deny every non-admin.
     */
    assignedUserIds: string[];
    teamMode:        boolean;
}

export function canEdit(
    user: CanEditUser,
    inspection: CanEditInspection,
    // Section-scope edit restrictions were removed with the specialist role
    // (2026-06-13). The param is retained for call-site stability but unused.
    _sectionId?: string,
): boolean {
    const role = user.role;

    if (isAdminRole(role)) return true;
    if (role === ROLE.AGENT)  return false;

    if (!inspection.assignedUserIds.includes(user.id)) return false;

    if (role === ROLE.INSPECTOR) return true;

    // Unknown / new roles default to deny — safer than fail-open.
    return false;
}
