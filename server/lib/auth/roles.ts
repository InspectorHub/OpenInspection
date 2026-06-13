/**
 * Single source of truth for the role taxonomy. Every consumer (Zod enums,
 * drizzle column enums, requireRole, UI labels) MUST derive from ROLES rather
 * than re-declaring string literals, so a role add/rename/remove is a one-line
 * change with the compiler flagging every stale callsite.
 */
export const ROLES = ['owner', 'admin', 'inspector', 'agent'] as const;

export type Role = typeof ROLES[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner:     'Owner',
  admin:     'Admin',     // renamed to 'Manager' in a later task
  inspector: 'Inspector',
  agent:     'Agent',
};

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}
