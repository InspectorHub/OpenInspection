import { ROLE } from '../auth/roles';

/**
 * Design System 0520 subsystem C phase 4 — canEdit permission matrix.
 *
 * Pure decision function consumed by every write-bearing route to
 * answer "is this user allowed to mutate this inspection (and
 * optionally this section)?" before the service-layer write fires.
 *
 * Role outcomes:
 *   - owner / admin  → always true
 *   - inspector      → true when caller is on the inspection
 *                       (inspectorId / leadInspectorId / helperInspectorIds)
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
    id:                 string;
    inspectorId:        string | null;
    leadInspectorId:    string | null;
    helperInspectorIds: string;   // JSON-encoded string array
    teamMode:           boolean;
}

function safeJsonArray(raw: string): string[] {
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter(s => typeof s === 'string') : [];
    } catch {
        return [];
    }
}

export function canEdit(
    user: CanEditUser,
    inspection: CanEditInspection,
    // Section-scope edit restrictions were removed with the specialist role
    // (2026-06-13). The param is retained for call-site stability but unused.
    _sectionId?: string,
): boolean {
    const role = user.role;

    if (role === ROLE.OWNER || role === ROLE.MANAGER) return true;
    if (role === ROLE.AGENT)  return false;

    const helpers = safeJsonArray(inspection.helperInspectorIds);
    const onInspection =
        inspection.inspectorId === user.id ||
        inspection.leadInspectorId === user.id ||
        helpers.includes(user.id);
    if (!onInspection) return false;

    if (role === ROLE.INSPECTOR) return true;

    // Unknown / new roles default to deny — safer than fail-open.
    return false;
}
