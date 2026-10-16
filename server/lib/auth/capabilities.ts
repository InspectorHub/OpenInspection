import type { Role } from './roles';
import { coerceOverrides as coerceWith, type BitDecl } from './capability-overrides';

export const TOGGLEABLE = [
  'publish', 'scheduleOthers', 'inspectionFees', 'companyFinance', 'manageContacts', 'viewCommunication',
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
  // Deleting an inspection removes its report data and media for good, so it is
  // a switch a company can take away from a manager or an inspector. On by
  // default for everyone who could already do it; the roster rule (an inspector
  // deletes only an inspection they lead) is separate and still applies.
  'deleteInspection',
  // Writing report content: results, media, units, collaborative editing,
  // statutory and compliance inputs, cost items. Reading the same data is not
  // affected, and neither is publishing. On by default for every role that could
  // already author; staff default to off.
  'editReports',
] as const;

/** The declared shape of every staff bit. All boolean today; see capability-overrides.ts. */
const STAFF_BITS: BitDecl = Object.fromEntries(TOGGLEABLE.map(c => [c, 'boolean'])) as BitDecl;

export type Capability = typeof TOGGLEABLE[number];
export type CapabilitySet = Record<Capability, boolean>;
export type PermissionOverrides = Partial<CapabilitySet>;

const ROLE_DEFAULTS: Record<Role, CapabilitySet> = {
  owner:     { publish: true,  scheduleOthers: true,  inspectionFees: true,  companyFinance: true,  manageContacts: true,  viewCommunication: true,
               templateCreate: true,  templateEdit: true,  templateDelete: true,  templateImport: true, deleteInspection: true,
               editReports: true },
  manager:   { publish: true,  scheduleOthers: true,  inspectionFees: true,  companyFinance: true,  manageContacts: true,  viewCommunication: true,
               templateCreate: true,  templateEdit: true,  templateDelete: true,  templateImport: true, deleteInspection: true,
               editReports: true },
  // An inspector needs to know whether their own report reached the buyer's agent.
  // They also author the templates they inspect against, so create/edit/import
  // stay on; only DELETE is off, whose repair cost is rebuild-from-scratch.
  inspector: { publish: true,  scheduleOthers: false, inspectionFees: true,  companyFinance: false, manageContacts: false, viewCommunication: true,
               templateCreate: true,  templateEdit: true,  templateDelete: false, templateImport: true, deleteInspection: true,
               editReports: true },
  // Office user: runs the booking (creates, schedules, reassigns and cancels unpaid
  // jobs, edits the order fields), manages contacts and messages, sends a report
  // that is already published, and sees inspection prices. Does not write report
  // content, sign or publish (`publish` is pinned off below), author templates, or
  // see company finances. Everything else can be widened or narrowed per person.
  staff:     { publish: false, scheduleOthers: true,  inspectionFees: true,  companyFinance: false, manageContacts: true,  viewCommunication: true,
               templateCreate: false, templateEdit: false, templateDelete: false, templateImport: false, deleteInspection: false,
               editReports: false },
  agent:     { publish: false, scheduleOthers: false, inspectionFees: false, companyFinance: false, manageContacts: false, viewCommunication: false,
               templateCreate: false, templateEdit: false, templateDelete: false, templateImport: false, deleteInspection: false,
               editReports: false },
};
/** owner is never reducible by overrides; agent is never elevated by them; staff never publish.
 *  A capability MISSING from any entry silently opts out of that guarantee,
 *  which is why each is restated in full rather than spread from the defaults. */
const FIXED: Partial<Record<Role, Partial<CapabilitySet>>> = {
  owner: { publish: true, scheduleOthers: true, inspectionFees: true, companyFinance: true, manageContacts: true, viewCommunication: true,
           templateCreate: true, templateEdit: true, templateDelete: true, templateImport: true, deleteInspection: true,
           editReports: true },
  agent: { publish: false, scheduleOthers: false, inspectionFees: false, companyFinance: false, manageContacts: false, viewCommunication: false,
           templateCreate: false, templateEdit: false, templateDelete: false, templateImport: false, deleteInspection: false,
           editReports: false },
  // Publishing is signing: the report goes out under the inspector's name. Pinned off
  // so no override or permission template can hand it to an office user; a company
  // that wants office publishing makes that person a manager. Only this one bit is
  // pinned, every other staff capability stays adjustable.
  staff: { publish: false },
};

/** The capabilities an override cannot change for `role`. A form uses this to show those switches as fixed. */
export function pinnedCapabilities(role: Role): readonly Capability[] {
  const pinned = FIXED[role];
  return pinned ? TOGGLEABLE.filter((cap) => typeof pinned[cap] === 'boolean') : [];
}

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
/**
 * Overrides stored before `financial` was split. Read through only: the old value
 * stands for both new keys unless a new key is stored explicitly, and nothing here
 * ever writes the old key back (the Team page and invites emit new keys only).
 */
function withLegacyFinancial(value: unknown): unknown {
  let obj: unknown = value;
  if (typeof value === 'string') {
    try { obj = JSON.parse(value); } catch { return value; }
  }
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return value;
  const { financial, ...rest } = obj as Record<string, unknown>;
  if (typeof financial !== 'boolean') return rest;
  return { inspectionFees: financial, companyFinance: financial, ...rest };
}

export function coerceOverrides(value: unknown): PermissionOverrides | null {
  return coerceWith(STAFF_BITS, withLegacyFinancial(value)) as PermissionOverrides | null;
}
