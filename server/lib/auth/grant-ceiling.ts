import { AppError, ErrorCode, Errors } from '../errors';
import type { Role } from './roles';
import {
    coerceOverrides,
    getCapabilities,
    TOGGLEABLE,
    type Capability,
    type CapabilitySet,
    type PermissionOverrides,
} from './capabilities';

/**
 * Who may give what to whom.
 *
 * An owner is unrestricted. A manager may give at most what the manager holds:
 *
 *   - ROLE ceiling: a manager may place someone only in a role at or below
 *     manager. Making an owner is an owner's act.
 *   - CAPABILITY ceiling: a capability the manager does not hold themselves may
 *     not be turned ON for someone else, whether by a switch on the invite or the
 *     member, or implicitly by the role template of the role they are placed in.
 *     Turning a capability OFF is always allowed.
 *   - SELF: a manager cannot change their own permission overrides (their own
 *     role is already immovable).
 *
 * Everything that writes a role or a set of overrides for another person goes
 * through `assertMayGrant`: the Team page's invite and edit, the REST and MCP
 * routes that sit on the same service methods, and the member rows of a bulk
 * import. A second copy of this rule would be the place a path escapes it.
 *
 * Owner-rank rules (only an owner touches an owner) stay in `owner-guard.ts`;
 * this file does not restate them.
 */

/** Roles a manager may place someone in. Anything not listed needs an owner. */
const MANAGER_GRANTABLE_ROLES: readonly Role[] = ['manager', 'inspector', 'staff'];

/** The acting person: their role, and their RESOLVED capabilities (role plus their own overrides). */
export interface GrantActor {
    role: Role;
    capabilities: CapabilitySet;
    /** Who is acting, when the caller knows; only used to attribute the record of a refusal. */
    userId?: string | undefined;
}

const CEILING_CODES: ReadonlySet<string> = new Set([
    ErrorCode.CAPABILITY_CEILING,
    ErrorCode.ROLE_CEILING,
    ErrorCode.SELF_PERMISSION_CHANGE,
]);

/** Whether an error is one of the grant ceiling's own refusals (the ones worth a durable record). */
export function isCeilingRefusal(err: unknown): err is AppError {
    return err instanceof AppError && CEILING_CODES.has(err.code);
}

/** Whether the actor may place someone in `role`. The Team page uses the same answer to build its role select. */
export function grantableRoles(actorRole: Role): readonly Role[] {
    if (actorRole === 'owner') return ['owner', ...MANAGER_GRANTABLE_ROLES];
    if (actorRole === 'manager') return MANAGER_GRANTABLE_ROLES;
    return [];
}

/** The capabilities the actor may switch ON for others. */
export function grantableCapabilities(actor: GrantActor): readonly Capability[] {
    if (actor.role === 'owner') return TOGGLEABLE;
    return TOGGLEABLE.filter((cap) => actor.capabilities[cap]);
}

/**
 * The state a grant starts from and the state it asks for. `from` is null for a
 * brand-new invite, where the person holds nothing yet.
 */
export interface GrantChange {
    from: { role: Role; overrides: PermissionOverrides | null } | null;
    to: { role: Role; overrides: PermissionOverrides | null };
}

/** Capabilities this change turns on for the target that the target did not already hold. */
export function newlyGranted(change: GrantChange): Capability[] {
    const after = getCapabilities(change.to.role, coerceOverrides(change.to.overrides));
    const before = change.from
        ? getCapabilities(change.from.role, coerceOverrides(change.from.overrides))
        : null;
    return TOGGLEABLE.filter((cap) => after[cap] && !(before?.[cap] ?? false));
}

/**
 * Throws 403 when the actor may not make this change. Owners always pass.
 * Any actor that is neither owner nor manager is refused: the routes already
 * keep them out, and this must not become the thing that lets one in.
 */
export function assertMayGrant(actor: GrantActor, change: GrantChange): void {
    if (actor.role === 'owner') return;
    if (actor.role !== 'manager') throw Errors.Forbidden('Only an owner or a manager can change team access');

    if (!MANAGER_GRANTABLE_ROLES.includes(change.to.role)) {
        throw Errors.RoleCeiling(change.to.role);
    }

    const beyond = newlyGranted(change).filter((cap) => !actor.capabilities[cap]);
    if (beyond.length > 0) throw Errors.CapabilityCeiling(beyond);
}

/**
 * Capabilities whose EFFECTIVE value differs between two states. Effective means
 * role template plus overrides, pinned values applied: a stored override that
 * restates the template, or a role move that changes nothing a member holds,
 * differs in no capability.
 */
export function effectiveCapabilitiesDiffer(
    a: { role: Role; overrides: PermissionOverrides | null },
    b: { role: Role; overrides: PermissionOverrides | null },
): Capability[] {
    const before = getCapabilities(a.role, coerceOverrides(a.overrides));
    const after = getCapabilities(b.role, coerceOverrides(b.overrides));
    return TOGGLEABLE.filter((cap) => before[cap] !== after[cap]);
}

/** Whether two states grant exactly the same capabilities. */
export function sameEffective(
    a: { role: Role; overrides: PermissionOverrides | null },
    b: { role: Role; overrides: PermissionOverrides | null },
): boolean {
    return effectiveCapabilitiesDiffer(a, b).length === 0;
}
