import type { Role } from './roles';
import { coerceOverrides as coerceWith, whitelistOverrides as whitelistWith, type BitDecl } from './capability-overrides';

export const TOGGLEABLE = ['publish', 'scheduleOthers', 'financial', 'manageContacts', 'viewCommunication'] as const;

/** The declared shape of every staff bit. All boolean today; see capability-overrides.ts. */
export const STAFF_BITS: BitDecl = Object.fromEntries(TOGGLEABLE.map(c => [c, 'boolean'])) as BitDecl;

export type Capability = typeof TOGGLEABLE[number];
export type CapabilitySet = Record<Capability, boolean>;
export type PermissionOverrides = Partial<CapabilitySet>;

const ROLE_DEFAULTS: Record<Role, CapabilitySet> = {
  owner:     { publish: true,  scheduleOthers: true,  financial: true,  manageContacts: true,  viewCommunication: true },
  manager:   { publish: true,  scheduleOthers: true,  financial: true,  manageContacts: true,  viewCommunication: true },
  // An inspector needs to know whether their own report reached the buyer's agent.
  inspector: { publish: true,  scheduleOthers: false, financial: false, manageContacts: false, viewCommunication: true },
  agent:     { publish: false, scheduleOthers: false, financial: false, manageContacts: false, viewCommunication: false },
};
/** owner is never reducible by overrides; agent is never elevated by them. */
const FIXED: Partial<Record<Role, Partial<CapabilitySet>>> = {
  owner: { publish: true, scheduleOthers: true, financial: true, manageContacts: true, viewCommunication: true },
  agent: { publish: false, scheduleOthers: false, financial: false, manageContacts: false, viewCommunication: false },
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

/**
 * Coerce an unknown column value into PermissionOverrides. The
 * `permission_overrides` column is drizzle `{ mode: 'json' }`, so a select may
 * hand back an already-parsed object (json mode) OR a raw string (some drivers
 * / test fixtures). Both delegate to the shared mechanic in
 * capability-overrides.ts — the contact-role axis uses the same one, so a
 * coercion fix can never land on one side only.
 */
export function coerceOverrides(value: unknown): PermissionOverrides | null {
  return coerceWith(STAFF_BITS, value) as PermissionOverrides | null;
}

export function whitelistOverrides(parsed: Record<string, unknown>): PermissionOverrides | null {
  return whitelistWith(STAFF_BITS, parsed) as PermissionOverrides | null;
}
