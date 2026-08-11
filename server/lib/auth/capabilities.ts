import type { Role } from './roles';
import { coerceOverrides as coerceWith, type BitDecl } from './capability-overrides';

export const TOGGLEABLE = [
  'publish', 'scheduleOthers', 'financial', 'manageContacts', 'viewCommunication',
  // Four verbs, not one "Add/Edit Template" toggle (which is what Spectora
  // ships). The split exists because the four are not equally recoverable:
  // EDIT is the irreversible one -- there is no template_versions table, and the
  // "History" affordance is EntityAuditTrail, which records THAT a change
  // happened and not the content to roll back to -- yet it stays ON for
  // inspectors so fixing a typo does not need an owner. DELETE is the guarded
  // one (deleteTemplate refuses at every reference) and is still OFF by
  // default, because its repair cost is rebuild-from-scratch rather than
  // change-it-back. See #307 and specs/2026-06-13-role-permission-templates-design.md.
  'templateCreate', 'templateEdit', 'templateDelete', 'templateImport',
] as const;

/** The declared shape of every staff bit. All boolean today; see capability-overrides.ts. */
const STAFF_BITS: BitDecl = Object.fromEntries(TOGGLEABLE.map(c => [c, 'boolean'])) as BitDecl;

export type Capability = typeof TOGGLEABLE[number];
export type CapabilitySet = Record<Capability, boolean>;
export type PermissionOverrides = Partial<CapabilitySet>;

const ROLE_DEFAULTS: Record<Role, CapabilitySet> = {
  owner:     { publish: true,  scheduleOthers: true,  financial: true,  manageContacts: true,  viewCommunication: true,
               templateCreate: true,  templateEdit: true,  templateDelete: true,  templateImport: true },
  manager:   { publish: true,  scheduleOthers: true,  financial: true,  manageContacts: true,  viewCommunication: true,
               templateCreate: true,  templateEdit: true,  templateDelete: true,  templateImport: true },
  // An inspector needs to know whether their own report reached the buyer's agent.
  // They also author the templates they inspect against, so create/edit/import
  // stay on; only DELETE is off, whose repair cost is rebuild-from-scratch.
  inspector: { publish: true,  scheduleOthers: false, financial: false, manageContacts: false, viewCommunication: true,
               templateCreate: true,  templateEdit: true,  templateDelete: false, templateImport: true },
  agent:     { publish: false, scheduleOthers: false, financial: false, manageContacts: false, viewCommunication: false,
               templateCreate: false, templateEdit: false, templateDelete: false, templateImport: false },
};
/** owner is never reducible by overrides; agent is never elevated by them.
 *  A capability MISSING from either map silently opts out of that guarantee,
 *  which is why both are restated in full rather than spread from the defaults. */
const FIXED: Partial<Record<Role, Partial<CapabilitySet>>> = {
  owner: { publish: true, scheduleOthers: true, financial: true, manageContacts: true, viewCommunication: true,
           templateCreate: true, templateEdit: true, templateDelete: true, templateImport: true },
  agent: { publish: false, scheduleOthers: false, financial: false, manageContacts: false, viewCommunication: false,
           templateCreate: false, templateEdit: false, templateDelete: false, templateImport: false },
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
