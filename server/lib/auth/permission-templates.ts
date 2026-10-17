import { getCapabilities, coerceOverrides, TOGGLEABLE, SETTABLE_CAPABILITIES, type Capability, type CapabilitySet, type PermissionOverrides } from './capabilities';
import { ROLE, type Role } from './roles';

/**
 * Permission templates: a named starting point for an invite or a member, made of
 * a base role and the switches that differ from that role's defaults.
 *
 * Two kinds exist and they resolve to the same shape:
 *
 *   - SYSTEM templates are the constants below. They need no table, can change
 *     between versions, and are identified by a stable `key`.
 *   - COMPANY templates are rows in `permission_templates` ("custom roles"), each
 *     with its own name and switch set, identified by id.
 *
 * Applying either one COPIES it: the role and a sparse switch diff are stamped on
 * the invite or the member. There is no link back, so changing a template never
 * changes anyone who already received it, and nothing records which template a
 * person came from. The Team page shows "which template does this person match"
 * by comparing resolved capabilities (`matchTemplate`), not by reading a column.
 *
 * Roles a template may be based on exclude `owner` (never reducible) and `agent`
 * (never a team member).
 */
export const TEMPLATE_ROLES = [ROLE.MANAGER, ROLE.INSPECTOR, ROLE.STAFF] as const satisfies readonly Role[];
export type TemplateRole = typeof TEMPLATE_ROLES[number];

export function isTemplateRole(value: unknown): value is TemplateRole {
    return typeof value === 'string' && (TEMPLATE_ROLES as readonly string[]).includes(value);
}

/** The most company templates (archived ones do not count) one company may hold. */
export const MAX_COMPANY_TEMPLATES = 25;
/** The longest template name, in characters. */
export const MAX_TEMPLATE_NAME_LENGTH = 60;

export interface SystemTemplate {
    /** Stable identifier. Never reused for a different meaning. */
    key: string;
    /** English name and description, for API and MCP clients. The Team page shows translated copy keyed on `key`. */
    name: string;
    description: string;
    baseRole: TemplateRole;
    /** Switches that differ from the base role's defaults. May restate a default; `resolveTemplate` drops those. */
    overrides: PermissionOverrides;
}

export const SYSTEM_TEMPLATES: readonly SystemTemplate[] = [
    { key: 'inspector_standard', name: 'Inspector', baseRole: ROLE.INSPECTOR, overrides: {},
      description: 'The inspector role with its default switches.' },
    // Works under another inspector: no scheduling for others, nothing destructive. Seeing only the
    // inspections assigned or shared with the person is a separate visibility setting, not a switch here.
    { key: 'inspector_assistant', name: 'Assistant inspector', baseRole: ROLE.INSPECTOR,
      overrides: { scheduleOthers: false, deleteInspection: false, templateCreate: false, templateEdit: false, templateImport: false },
      description: 'An inspector who helps on inspections: cannot schedule for others, delete inspections or change templates.' },
    { key: 'inspector_trainee', name: 'Trainee inspector', baseRole: ROLE.INSPECTOR,
      overrides: { publish: false, templateCreate: false, templateEdit: false, templateImport: false, deleteInspection: false },
      description: 'An inspector who writes up inspections but cannot publish reports, change templates or delete inspections.' },
    { key: 'inspector_lead', name: 'Lead inspector', baseRole: ROLE.INSPECTOR,
      overrides: { scheduleOthers: true, manageContacts: true },
      description: 'An inspector who can also schedule for others and manage contacts.' },
    { key: 'manager_standard', name: 'Manager', baseRole: ROLE.MANAGER, overrides: {},
      description: 'The manager role with its default switches.' },
    { key: 'manager_no_reports', name: 'Office manager (no report editing)', baseRole: ROLE.MANAGER,
      overrides: { editReports: false, inspectionFees: false, companyFinance: false },
      description: 'A manager who runs the office but does not write report content or see prices and company finances.' },
    { key: 'office_scheduler', name: 'Office scheduler', baseRole: ROLE.STAFF, overrides: {},
      description: 'Office staff with their default switches: bookings, contacts and messages.' },
    { key: 'office_finance', name: 'Office finance', baseRole: ROLE.STAFF,
      overrides: { companyFinance: true },
      description: 'Office staff who can also see company finances.' },
    { key: 'office_auditor', name: 'Office auditor', baseRole: ROLE.STAFF,
      overrides: { scheduleOthers: false, manageContacts: false, companyFinance: true },
      description: 'Office staff who see prices, company finances and sent messages but cannot reschedule or change contacts.' },
];

/** What a template resolves to: the role and the sparse diff to store, exactly as an invite or member row holds them. */
export interface ResolvedTemplate {
    role: TemplateRole;
    permissionOverrides: PermissionOverrides | null;
}

/**
 * Only the keys that differ from the role's defaults. Pinned switches (a staff
 * member can never publish) are dropped because the role resolves them regardless.
 * Same rule as `TeamService.diffOverrides`; kept here too so this module has no
 * dependency on a service.
 */
export function diffAgainstRole(role: Role, overrides: PermissionOverrides | null | undefined): PermissionOverrides | null {
    if (!overrides) return null;
    const base = getCapabilities(role, null);
    const effective = getCapabilities(role, overrides);
    const diff: PermissionOverrides = {};
    for (const cap of SETTABLE_CAPABILITIES) {
        const wanted = overrides[cap];
        // A pinned switch resolves to the same value whatever is stored, so it differs from the base never.
        if (typeof wanted === 'boolean' && wanted !== base[cap] && effective[cap] === wanted) diff[cap] = wanted;
    }
    return Object.keys(diff).length ? diff : null;
}

export function findSystemTemplate(key: string): SystemTemplate | undefined {
    return SYSTEM_TEMPLATES.find((t) => t.key === key);
}

/** Resolves a system template to what gets stamped. Throws on an unknown key: a caller passes a key it listed. */
export function resolveTemplate(key: string): ResolvedTemplate {
    const t = findSystemTemplate(key);
    if (!t) throw new Error(`Unknown system permission template: ${key}`);
    return { role: t.baseRole, permissionOverrides: diffAgainstRole(t.baseRole, t.overrides) };
}

/** A company template as the application sees it: the stored row read through the capability whitelist. */
export interface CompanyTemplate {
    id: string;
    name: string;
    baseRole: TemplateRole;
    overrides: PermissionOverrides | null;
}

/**
 * Reads a stored row. A key this version does not know (written by a newer one) is
 * dropped rather than failing the read, and a base role that is no longer allowed
 * yields null so the template is skipped instead of the whole list failing.
 */
export function toCompanyTemplate(row: { id: string; name: string; baseRole: string; overrides: unknown }): CompanyTemplate | null {
    if (!isTemplateRole(row.baseRole)) return null;
    return { id: row.id, name: row.name, baseRole: row.baseRole, overrides: coerceOverrides(row.overrides) };
}

export function resolveCompanyTemplate(t: CompanyTemplate): ResolvedTemplate {
    return { role: t.baseRole, permissionOverrides: diffAgainstRole(t.baseRole, t.overrides) };
}

/**
 * What stamping a template and then adding the requester's explicit switches on top
 * stores. The order is: role defaults, the template's switches, the explicit ones.
 */
export function layerOverrides(
    role: Role,
    template: PermissionOverrides | null,
    explicit: Partial<Record<Capability, boolean | undefined>> | null | undefined,
): PermissionOverrides | null {
    const merged: PermissionOverrides = { ...(template ?? {}) };
    if (explicit) for (const cap of SETTABLE_CAPABILITIES) {
        const v = explicit[cap];
        if (typeof v === 'boolean') merged[cap] = v;
    }
    return diffAgainstRole(role, merged);
}

/** One entry `matchTemplate` can return. */
export interface MatchableTemplate {
    /** `key` for a system template, `id` for a company one. */
    ref: string;
    system: boolean;
    name: string;
    baseRole: TemplateRole;
    overrides: PermissionOverrides | null;
}

function sameCaps(a: CapabilitySet, b: CapabilitySet): boolean {
    return TOGGLEABLE.every((cap) => a[cap] === b[cap]);
}

/**
 * The template a person currently matches: the first whose base role is the
 * person's role and whose resolved capabilities equal theirs. Company templates are
 * tried before system ones, so a company that saved a copy of a system template
 * sees its own name. Null means "custom".
 */
export function matchTemplate(
    role: Role,
    overrides: PermissionOverrides | null,
    templates: readonly MatchableTemplate[],
): MatchableTemplate | null {
    const mine = getCapabilities(role, overrides);
    const ordered = [...templates].sort((x, y) => Number(x.system) - Number(y.system));
    return ordered.find((t) => t.baseRole === role && sameCaps(mine, getCapabilities(t.baseRole, t.overrides))) ?? null;
}

/** System templates in the shape `matchTemplate` takes. */
export function systemMatchables(): MatchableTemplate[] {
    return SYSTEM_TEMPLATES.map((t) => ({ ref: t.key, system: true, name: t.name, baseRole: t.baseRole, overrides: t.overrides }));
}

export function companyMatchables(templates: readonly CompanyTemplate[]): MatchableTemplate[] {
    return templates.map((t) => ({ ref: t.id, system: false, name: t.name, baseRole: t.baseRole, overrides: t.overrides }));
}
