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
