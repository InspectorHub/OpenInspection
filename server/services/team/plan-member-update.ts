import { Errors } from '../../lib/errors';
import type { UserRole } from '../../types/auth';
import {
    assertMayGrant,
    effectiveCapabilitiesDiffer,
    type GrantActor,
} from '../../lib/auth/grant-ceiling';
import {
    coerceOverrides,
    getCapabilities,
    TOGGLEABLE,
    SETTABLE_CAPABILITIES,
    type Capability,
    type PermissionOverrides,
} from '../../lib/auth/capabilities';

/**
 * Loose shape accepted from the validated request body. Zod under
 * `exactOptionalPropertyTypes` infers `boolean | undefined` per key, which is
 * not assignable to the strict `PermissionOverrides`; `diffOverrides` reads each
 * value through a `typeof === 'boolean'` guard so the looseness is safe.
 */
export type RequestedOverrides = Partial<Record<Capability, boolean | undefined>>;

/**
 * Reduce a requested override map to only the capabilities whose value
 * differs from the role's template default. Returns null when nothing
 * differs (the role template already covers the request) so the stored
 * column stays null. owner/agent capabilities are pinned by getCapabilities,
 * so a diff against the effective template never persists a moot toggle.
 */
export function diffOverrides(role: UserRole, requested?: RequestedOverrides | null): PermissionOverrides | null {
    if (!requested) return null;
    const template = getCapabilities(role, null);
    const diff: PermissionOverrides = {};
    // Only what a request may write. A capability whose write surface is closed never lands
    // in a stored map from here; `planMemberUpdate` carries an existing value across an edit.
    for (const cap of SETTABLE_CAPABILITIES) {
        const value = requested[cap];
        if (typeof value === 'boolean' && value !== template[cap]) diff[cap] = value;
    }
    return Object.keys(diff).length ? diff : null;
}

/**
 * Carry across an edit any stored switch whose write surface is closed. Without this, saving
 * an unrelated change on a restricted inspector would rebuild their overrides from the
 * settable switches only and silently lift the restriction. Kept only while it still takes
 * effect for the (possibly new) role, so a role that pins the switch stores nothing for it.
 */
function withUnsettableKept(
    role: UserRole,
    diff: PermissionOverrides | null,
    current: PermissionOverrides | null,
): PermissionOverrides | null {
    if (!current) return diff;
    const out: PermissionOverrides = { ...(diff ?? {}) };
    const base = getCapabilities(role, null);
    for (const cap of TOGGLEABLE) {
        if (SETTABLE_CAPABILITIES.includes(cap)) continue;
        const value = current[cap];
        if (typeof value === 'boolean' && value !== base[cap] && getCapabilities(role, { [cap]: value })[cap] === value) out[cap] = value;
    }
    return Object.keys(out).length ? out : null;
}

export interface MemberUpdatePlan {
    nextRole: UserRole;
    /** What to store: only what differs from the (possibly new) role template. */
    permissionOverrides: PermissionOverrides | null;
    roleChanged: boolean;
    /** Names of capabilities whose EFFECTIVE value moves; never their values. */
    capabilitiesChanged: Capability[];
    /** False when the request leaves the member's effective access exactly as it is. */
    changed: boolean;
}

/**
 * Decides what an edit would do and whether the acting person may do it. Pure:
 * it reads nothing and writes nothing, so every refusal happens before any write.
 *
 * `requested` undefined means the caller did not mention overrides, which is
 * "leave them as they are" and never "clear them"; only an explicit null (or an
 * empty map) clears.
 */
export function planMemberUpdate(args: {
    actor: GrantActor;
    isSelf: boolean;
    current: { role: UserRole; permissionOverrides: unknown };
    nextRole: UserRole;
    requested: RequestedOverrides | null | undefined;
}): MemberUpdatePlan {
    const { actor, isSelf, current, nextRole, requested } = args;
    const currentOverrides = coerceOverrides(current.permissionOverrides);
    const permissionOverrides = withUnsettableKept(
        nextRole,
        requested === undefined ? diffOverrides(nextRole, currentOverrides) : diffOverrides(nextRole, requested),
        currentOverrides,
    );

    // The ceiling: only what this change newly turns ON counts, so a manager
    // can still edit (or turn off) a member who already holds something the
    // manager does not. Role template grants count too, not just switches.
    const from = { role: current.role, overrides: currentOverrides };
    const to = { role: nextRole, overrides: permissionOverrides };
    assertMayGrant(actor, { from, to });

    const capabilitiesChanged = effectiveCapabilitiesDiffer(from, to);
    const roleChanged = nextRole !== current.role;

    // A manager does not edit their own permissions; ask an owner. Compared on
    // EFFECTIVE access, so restating what is already held is not a change.
    // Owners are exempt: owner is pinned.
    if (isSelf && actor.role !== 'owner' && capabilitiesChanged.length > 0) {
        throw Errors.SelfPermissionChange();
    }

    return {
        nextRole,
        permissionOverrides,
        roleChanged,
        capabilitiesChanged,
        changed: roleChanged || capabilitiesChanged.length > 0,
    };
}
