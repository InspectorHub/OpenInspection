/**
 * What one connected colleague is shown of the company-wide presence roster.
 *
 * The roster says, for every member, which inspection they currently have open. A person whose
 * access is limited to their assigned inspections must not learn which other inspections exist or
 * who is working on them, so each of their frames carries `currentInspectionId: null` for everyone
 * but themselves. Online state and last-seen time are the company roster and stay as they are.
 *
 * Kept free of `cloudflare:workers` so a node-environment test can drive it.
 */
export interface TenantMemberState {
    online:              boolean;
    currentInspectionId: string | null;
    lastSeenAt:          number;
}

export interface PresenceViewer {
    userId:     string;
    /** True when the viewer sees only inspections assigned to them. */
    restricted: boolean;
}

export function membersFor(
    members: Record<string, TenantMemberState>,
    viewer: PresenceViewer,
): Record<string, TenantMemberState> {
    if (!viewer.restricted) return members;
    const out: Record<string, TenantMemberState> = {};
    for (const [userId, state] of Object.entries(members)) {
        out[userId] = userId === viewer.userId ? state : { ...state, currentInspectionId: null };
    }
    return out;
}
