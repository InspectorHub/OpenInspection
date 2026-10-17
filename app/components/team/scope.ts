/**
 * Which inspections an inspector can see, as the Team page's two drawers decide it.
 *
 * Pure, so the invite drawer, the edit drawer and their tests share one answer. The server enforces
 * the scope (`server/lib/inspection/visibility.ts`); this only makes the form say what the request
 * will carry, including the one case where the request must state a value it would otherwise leave out.
 */
import { getCapabilities, type CapabilitySet, type PermissionOverrides } from "../../../server/lib/auth/capabilities";

/** The capability the scope control carries, and the only one: the capability list renders the rest. */
export const SCOPE_CAPABILITIES = ["viewAllInspections"] as const;

/** Only an inspector's scope can be chosen: every other role pins it, so the control is not offered. */
export function hasScopeChoice(role: string): boolean {
  return role === "inspector";
}

/**
 * The switches with the scope set. Narrowing it also drops `scheduleOthers`, which the server switches
 * off for anyone who cannot see every inspection, so the form never shows a grant that does nothing.
 */
export function withScope(caps: CapabilitySet, viewAll: boolean): CapabilitySet {
  return viewAll ? { ...caps, viewAllInspections: true } : { ...caps, viewAllInspections: false, scheduleOthers: false };
}

/**
 * The starting switches for a new invite: the role's, plus the company default for new inspectors where
 * nothing else has said. `overrides` are a permission template's; a template that carries the scope wins.
 */
export function inviteCapabilities(
  role: Parameters<typeof getCapabilities>[0],
  companyRestrictsNew: boolean,
  overrides: PermissionOverrides | null = null,
): CapabilitySet {
  const base = getCapabilities(role, overrides);
  const stated = typeof overrides?.viewAllInspections === "boolean";
  return hasScopeChoice(role) && companyRestrictsNew && !stated ? withScope(base, false) : base;
}

/**
 * The scope an invite must STATE. A company whose default is "only assigned" stamps that default onto any
 * inspector invite that says nothing, so choosing "all inspections" has to be sent outright; where the
 * default is "all", saying nothing already means all and the request stays as it always was.
 */
export function statedScope(role: string, caps: CapabilitySet, companyRestrictsNew: boolean): PermissionOverrides {
  return hasScopeChoice(role) && companyRestrictsNew && caps.viewAllInspections ? { viewAllInspections: true } : {};
}
