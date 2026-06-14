import type { Role } from './roles';

export const TOGGLEABLE = ['publish', 'scheduleOthers', 'financial', 'manageContacts'] as const;
export type Capability = typeof TOGGLEABLE[number];
export type CapabilitySet = Record<Capability, boolean>;
export type PermissionOverrides = Partial<CapabilitySet>;

const ROLE_DEFAULTS: Record<Role, CapabilitySet> = {
  owner:     { publish: true,  scheduleOthers: true,  financial: true,  manageContacts: true },
  manager:   { publish: true,  scheduleOthers: true,  financial: true,  manageContacts: true },
  inspector: { publish: true,  scheduleOthers: false, financial: false, manageContacts: false },
  agent:     { publish: false, scheduleOthers: false, financial: false, manageContacts: false },
};
/** owner is never reducible by overrides; agent is never elevated by them. */
const FIXED: Partial<Record<Role, Partial<CapabilitySet>>> = {
  owner: { publish: true, scheduleOthers: true, financial: true, manageContacts: true },
  agent: { publish: false, scheduleOthers: false, financial: false, manageContacts: false },
};

export function getCapabilities(role: Role, overrides: PermissionOverrides | null): CapabilitySet {
  const base = { ...ROLE_DEFAULTS[role] };
  if (overrides) for (const cap of TOGGLEABLE) {
    if (typeof overrides[cap] === 'boolean') base[cap] = overrides[cap] as boolean;
  }
  const pinned = FIXED[role];
  if (pinned) for (const cap of TOGGLEABLE) {
    if (typeof pinned[cap] === 'boolean') base[cap] = pinned[cap] as boolean;
  }
  return base;
}

export function parseOverrides(json: string | null | undefined): PermissionOverrides | null {
  if (!json) return null;
  try {
    return whitelistOverrides(JSON.parse(json) as Record<string, unknown>);
  } catch { return null; }
}

/**
 * Coerce an unknown column value into PermissionOverrides. The
 * `permission_overrides` column is drizzle `{ mode: 'json' }`, so a select may
 * hand back an already-parsed object (json mode) OR a raw string (some drivers
 * / test fixtures). Strings route through JSON.parse; objects are whitelisted
 * directly. Either way only the four boolean capability keys survive — anything
 * else (null, number, malformed JSON, extra keys) collapses to null.
 */
export function coerceOverrides(value: unknown): PermissionOverrides | null {
  if (value == null) return null;
  if (typeof value === 'string') return parseOverrides(value);
  if (typeof value === 'object') return whitelistOverrides(value as Record<string, unknown>);
  return null;
}

function whitelistOverrides(parsed: Record<string, unknown>): PermissionOverrides | null {
  const out: PermissionOverrides = {};
  for (const cap of TOGGLEABLE) if (typeof parsed[cap] === 'boolean') out[cap] = parsed[cap] as boolean;
  return Object.keys(out).length ? out : null;
}
