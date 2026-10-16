/**
 * Single source of truth for the role taxonomy. Every consumer (Zod enums,
 * drizzle column enums, requireRole, UI labels) MUST derive from ROLES rather
 * than re-declaring string literals, so a role add/rename/remove is a one-line
 * change with the compiler flagging every stale callsite.
 */
export const ROLES = ['owner', 'manager', 'inspector', 'staff', 'agent'] as const;

export type Role = typeof ROLES[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner:     'Owner',
  manager:   'Manager',
  inspector: 'Inspector',
  staff:     'Staff',
  agent:     'Agent',
};

/**
 * Named role constants — prefer these over bare string literals in comparison
 * and assignment sites (the no-restricted-syntax lint rule enforces this).
 * Adding a new role requires updating ROLES above; this object is derived
 * automatically so any typo here is a compile error.
 */
export const ROLE = {
  OWNER:     'owner',
  MANAGER:   'manager',
  INSPECTOR: 'inspector',
  STAFF:     'staff',
  AGENT:     'agent',
} as const satisfies Record<string, Role>;

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/**
 * The administrator tier: `owner` and `manager` administer the company;
 * `inspector` and `agent` do not.
 *
 * This predicate is the ONE definition. It was previously re-derived in seven
 * places — `role === 'owner' || role === 'manager'` inline in three API
 * modules, as a same-named local in `mcp/tag-catalog`, inline in `rbac/can-edit`
 * and two frontend files, plus a separate copy in `app/lib/access.ts` whose
 * comment described itself as "mirroring" this module. A mirror is a copy, and
 * copies drift.
 *
 * An EIGHTH copy surfaced later, in `api/availability.ts`, written as
 * `![ROLE.MANAGER, ROLE.OWNER].includes(userRole)` — four times. It survived the
 * consolidation above for a reason worth knowing: `c.get('userRole')` was `any`
 * at the time (a route middleware annotated with hono's bare `Context` collapsed
 * every handler's Env), so `Array<'owner'|'manager'>.includes(any)` type-checked
 * happily. The copy was invisible to a compiler that had stopped asking.
 *
 * Note this is DIFFERENT from `getCapabilities(...).manageContacts` and friends:
 * this is the coarse role tier, capabilities are the per-user overrides layered
 * on top. Gating something on "is an admin" when you mean "may manage contacts"
 * is how a per-user override gets silently ignored — reach for the capability
 * when one exists for what you are guarding.
 */
const ADMIN_ROLES: ReadonlySet<string> = new Set<Role>([ROLE.OWNER, ROLE.MANAGER]);

export function isAdminRole(role: string | null | undefined): boolean {
  return role != null && ADMIN_ROLES.has(role);
}

/**
 * The tier a role is evaluated as by `requireRole`. `staff` (office user who
 * does not inspect) sits at the inspector tier, so every existing
 * `requireRole('owner', 'manager', 'inspector')` gate admits it without being
 * edited, and any gate that omits `inspector` keeps it out. The differences
 * between staff and an inspector are expressed as capabilities
 * (`editReports`, ...).
 */
export const ROLE_TIER: Record<Role, Role> = {
  owner:     ROLE.OWNER,
  manager:   ROLE.MANAGER,
  inspector: ROLE.INSPECTOR,
  staff:     ROLE.INSPECTOR,
  agent:     ROLE.AGENT,
};

/** Roles that can be assigned as the inspector on a job (booking, availability, assignment). */
export const FIELD_ROLES = [ROLE.OWNER, ROLE.MANAGER, ROLE.INSPECTOR] as const;

/** Whether a stored role string names a role that can be the inspector on a job. */
export function isFieldRole(role: string | null | undefined): boolean {
  return role != null && (FIELD_ROLES as readonly string[]).includes(role);
}

/** Roles that may sign in to the offline-first native client: the field roles, plus staff. */
export const NATIVE_APP_ROLES = [...FIELD_ROLES, ROLE.STAFF] as const;

/**
 * The one place that decides whether a role occupies a member seat. Staff are
 * office users and do not; every other role does. Seat accounting reads this
 * function and nothing else.
 */
export function countsTowardSeatQuota(role: Role): boolean {
  return role !== ROLE.STAFF;
}
