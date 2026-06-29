import type { Role } from "../auth/roles";
import { ROLE } from "../auth/roles";
import { roleAllowedScopeKinds } from "./scopes";

/**
 * Human-facing module groups layered over the controlled-vocabulary route tags
 * (docs/developers/07_route_metadata.md). The OAuth consent grid (`/oauth/authorize`)
 * renders one row per visible group with Read / Write checkboxes; ticking a box
 * expands to the underlying `kind:tag` scope strings the MCP server enforces.
 *
 * Every tag below is a real route tag in `server/api/**` (verified against the
 * actual `tags: [...]` metadata, which is the authoritative source for scope
 * matching — a few tags such as `contractor-types` and `sms` are used by routes
 * but predate the prose vocabulary list in the metadata doc).
 *
 * `adminOnly` groups are visible only to owner / manager roles.
 */
export interface ModuleGroup {
  key: string;
  label: string;
  tags: string[];
  adminOnly?: boolean;
}

export const MODULE_GROUPS: ModuleGroup[] = [
  { key: "inspections", label: "Inspections", tags: ["inspections"] },
  { key: "bookings", label: "Bookings", tags: ["bookings", "calendar"] },
  { key: "templates", label: "Templates", tags: ["templates", "services", "ratings", "contractor-types"] },
  { key: "contacts", label: "Contacts", tags: ["contacts", "agents", "team"] },
  { key: "invoices", label: "Invoices", tags: ["invoices"] },
  { key: "reports", label: "Reports & Repair", tags: ["recommendations", "agreements"] },
  { key: "messages", label: "Messaging", tags: ["messages", "notifications", "sms"] },
  { key: "admin", label: "Admin & Settings", tags: ["admin", "integrations", "qbo"], adminOnly: true },
];

/**
 * The module groups a given role may see on the consent screen. `adminOnly`
 * rows are hidden from everyone except owner / manager.
 */
export function visibleModuleGroups(role: Role): ModuleGroup[] {
  const isAdminRole = role === ROLE.OWNER || role === ROLE.MANAGER;
  return MODULE_GROUPS.filter((g) => !g.adminOnly || isAdminRole);
}

/**
 * Whether the consent grid should offer a Write column for this role. Roles
 * without the `write` capability (e.g. agent) only ever see Read checkboxes —
 * `computeGrantedScopes` would drop any write scope for them anyway, so the
 * column is hidden to avoid a misleading control.
 */
export function roleCanWrite(role: Role): boolean {
  return roleAllowedScopeKinds(role).includes("write");
}

/**
 * Derive the `selected` `kind:tag` scope strings from a submitted consent form.
 * Checkbox names are `read:<groupKey>` and `write:<groupKey>`. A ticked Write
 * box expands to both `write:<tag>` and `read:<tag>` for every tag in the group
 * (write implies read); a ticked Read box expands to `read:<tag>` only.
 *
 * Pure helper (FormData is a Web standard) so it can be unit-tested without the
 * route loader/action, and reused by the action to compute the granted set.
 */
export function selectedScopesFromForm(formData: FormData, groups: ModuleGroup[]): string[] {
  const selected = new Set<string>();
  for (const g of groups) {
    const write = formData.get(`write:${g.key}`) != null;
    const read = formData.get(`read:${g.key}`) != null;
    if (write) {
      for (const t of g.tags) {
        selected.add(`write:${t}`);
        selected.add(`read:${t}`);
      }
    } else if (read) {
      for (const t of g.tags) {
        selected.add(`read:${t}`);
      }
    }
  }
  return [...selected];
}
