/**
 * Single source of truth for the role taxonomy. Every consumer (Zod enums,
 * drizzle column enums, requireRole, UI labels) MUST derive from ROLES rather
 * than re-declaring string literals, so a role add/rename/remove is a one-line
 * change with the compiler flagging every stale callsite.
 */
export const ROLES = ['owner', 'manager', 'inspector', 'agent'] as const;

export type Role = typeof ROLES[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner:     'Owner',
  manager:   'Manager',
  inspector: 'Inspector',
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
