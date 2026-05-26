/**
 * Design System 0520 subsystem C phase 4 — canEdit permission matrix.
 *
 * Pure decision function consumed by every write-bearing route to
 * answer "is this user allowed to mutate this inspection (and
 * optionally this section)?" before the service-layer write fires.
 *
 * Role outcomes:
 *   - owner / admin  → always true
 *   - office         → always false (read-only seat by spec)
 *   - lead           → true when caller is on the inspection
 *                       (inspectorId / leadInspectorId / helperInspectorIds)
 *   - apprentice     → same as lead at the canEdit boundary; the
 *                       apprentice-write-to-queue routing happens in
 *                       InspectionService.patchItem (subsystem C P2)
 *   - specialist     → same as lead AND sectionId in user.assignedSectionIds
 *   - agent (legacy) → false (subsystem A buyer-agent view is read-only)
 *
 * Legacy 'inspector' role is aliased to 'lead' via normaliseRole.
 */
import { normaliseRole } from '../middleware/rbac';

export interface CanEditUser {
    id:                 string;
    role:               string;
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
    sectionId?: string,
): boolean {
    const role = normaliseRole(user.role);

    if (role === 'owner' || role === 'admin') return true;
    if (role === 'office') return false;
    if (role === 'agent')  return false;

    const helpers = safeJsonArray(inspection.helperInspectorIds);
    const onInspection =
        inspection.inspectorId === user.id ||
        inspection.leadInspectorId === user.id ||
        helpers.includes(user.id);
    if (!onInspection) return false;

    if (role === 'lead' || role === 'apprentice') return true;

    if (role === 'specialist') {
        if (!sectionId) return false;
        const sections = safeJsonArray(user.assignedSectionIds);
        return sections.includes(sectionId);
    }

    // Unknown / new roles default to deny — safer than fail-open.
    return false;
}
