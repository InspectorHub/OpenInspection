/**
 * What the Team page knows about permission templates, and the pure decisions it
 * makes with them. No React: the invite drawer, the edit drawer and the member
 * list all read the same answers from here, so they cannot disagree about which
 * template a person matches or which one a manager may not offer.
 *
 * A template is COPIED onto an invite or a member. Nothing here treats it as a
 * link, which is why "which template is this person on" is worked out by comparing
 * resolved capabilities rather than read from anywhere.
 */
import { getCapabilities, TOGGLEABLE, type CapabilitySet, type PermissionOverrides } from "../../../server/lib/auth/capabilities";
import { newlyGranted } from "../../../server/lib/auth/grant-ceiling";
import { matchTemplate, type MatchableTemplate, type TemplateRole } from "../../../server/lib/auth/permission-templates";
import { m } from "~/paraglide/messages";

/** One entry of `GET /api/team/permission-templates`, as the page holds it. */
export interface TemplateOption {
  /** The key of a built-in template or the id of a company one: what `templateId` carries. */
  id: string;
  system: boolean;
  /** English name from the server; the page shows a translated one for built-ins it knows. */
  name: string;
  description: string | null;
  baseRole: TemplateRole;
  overrides: PermissionOverrides;
}

// Thunks, so each string resolves at render inside the paraglide request scope.
const SYSTEM_NAMES: Record<string, () => string> = {
  inspector_standard: () => m.team_template_name_inspector_standard(),
  inspector_assistant: () => m.team_template_name_inspector_assistant(),
  inspector_trainee: () => m.team_template_name_inspector_trainee(),
  inspector_lead: () => m.team_template_name_inspector_lead(),
  manager_standard: () => m.team_template_name_manager_standard(),
  manager_no_reports: () => m.team_template_name_manager_no_reports(),
  office_scheduler: () => m.team_template_name_office_scheduler(),
  office_finance: () => m.team_template_name_office_finance(),
  office_auditor: () => m.team_template_name_office_auditor(),
};

const SYSTEM_DESCRIPTIONS: Record<string, () => string> = {
  inspector_standard: () => m.team_template_desc_inspector_standard(),
  inspector_assistant: () => m.team_template_desc_inspector_assistant(),
  inspector_trainee: () => m.team_template_desc_inspector_trainee(),
  inspector_lead: () => m.team_template_desc_inspector_lead(),
  manager_standard: () => m.team_template_desc_manager_standard(),
  manager_no_reports: () => m.team_template_desc_manager_no_reports(),
  office_scheduler: () => m.team_template_desc_office_scheduler(),
  office_finance: () => m.team_template_desc_office_finance(),
  office_auditor: () => m.team_template_desc_office_auditor(),
};

/** The name to show. A built-in key this build has no translation for falls back to the server's English name. */
export function templateName(t: Pick<TemplateOption, "id" | "system" | "name">): string {
  return t.system ? (SYSTEM_NAMES[t.id]?.() ?? t.name) : t.name;
}

export function templateDescription(t: Pick<TemplateOption, "id" | "system" | "description">): string | null {
  return t.system ? (SYSTEM_DESCRIPTIONS[t.id]?.() ?? t.description) : null;
}

/** The role and resolved switches a template gives. */
export function templateCapabilities(t: TemplateOption): CapabilitySet {
  return getCapabilities(t.baseRole, t.overrides);
}

/** Whether the form still shows exactly what the template gives. A template with edits applied is "Customized". */
export function templateMatchesForm(t: TemplateOption, role: string, caps: CapabilitySet): boolean {
  if (t.baseRole !== role) return false;
  const own = templateCapabilities(t);
  return TOGGLEABLE.every((cap) => own[cap] === caps[cap]);
}

/** The actor as the drawers know them: a role, and their own resolved switches when known. */
export interface TemplateActor {
  role: string;
  capabilities: Partial<CapabilitySet> | null;
}

/**
 * Whether applying `t` would turn on something the actor does not hold, so only
 * an owner can offer it. The server refuses the same thing (the grant ceiling);
 * this only declines to offer what would be refused. What the person already
 * holds is not a grant, so `from` is their current role and switches, or null
 * for an invite. An unknown actor is offered nothing.
 */
export function templateBeyondActor(
  actor: TemplateActor | null,
  t: TemplateOption,
  from: { role: TemplateRole; overrides: PermissionOverrides | null } | null,
): boolean {
  if (!actor) return true;
  if (actor.role === "owner") return false;
  return newlyGranted({ from, to: { role: t.baseRole, overrides: t.overrides } }).some((cap) => actor.capabilities?.[cap] !== true);
}

export function toMatchable(t: TemplateOption): MatchableTemplate {
  return { ref: t.id, system: t.system, name: templateName(t), baseRole: t.baseRole, overrides: t.overrides };
}

/**
 * The template a member currently matches, for the drawer's starting value.
 * Null when they match none (or hold a role no template is based on).
 */
export function matchedTemplate(role: string, overrides: PermissionOverrides | null, templates: readonly TemplateOption[]): TemplateOption | null {
  const hit = matchTemplate(role as TemplateRole, overrides, templates.map(toMatchable));
  return hit ? (templates.find((t) => t.id === hit.ref) ?? null) : null;
}

/**
 * The line under a member's role on the Team page: the template they match, or
 * "Custom". Nothing for an owner, an agent or a pending invite, which has no
 * member row to compare yet.
 */
export function templateBadge(
  member: { role: string; status: string; permissionOverrides: PermissionOverrides | null },
  templates: readonly TemplateOption[],
): string | null {
  if (member.status !== "active") return null;
  if (member.role !== "manager" && member.role !== "inspector" && member.role !== "staff") return null;
  if (templates.length === 0) return null;
  const hit = matchedTemplate(member.role, member.permissionOverrides, templates);
  return hit ? templateName(hit) : m.team_template_custom_badge();
}
