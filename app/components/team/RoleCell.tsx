import { Pill } from "@core/shared-ui";
import { getCapabilities, type PermissionOverrides } from "../../../server/lib/auth/capabilities";
import { ROLE_TONES, type Member } from "~/routes/team.shapes";
import { TemplateBadge } from "./PermissionTemplatesPanel";
import type { TemplateOption } from "./permission-template-ui";
import { m } from "~/paraglide/messages";

/** Whether a member sees only the inspections assigned to them. Worked out the way the server does, so a pinned role never reads as restricted. */
export function seesOnlyAssigned(member: Pick<Member, "role" | "permissionOverrides">): boolean {
  return member.role === "inspector"
    && getCapabilities("inspector", (member.permissionOverrides ?? null) as PermissionOverrides | null).viewAllInspections === false;
}

/**
 * The Role cell of the member table: the role, the template this member matches (or "Custom"), and
 * "Assigned only" for an inspector who sees only their own inspections, so the roster says who is
 * narrowed without opening each person.
 */
export function RoleCell({ member, canManage, templates }: { member: Member; canManage: boolean; templates: TemplateOption[] }) {
  return (
    <>
      <Pill tone={ROLE_TONES[member.role] || "gen"}>{member.role}</Pill>
      {/* The template this member matches, or "Custom". Worked out from their
          resolved permissions: nothing records where they started. */}
      {canManage && <TemplateBadge member={member} templates={templates} />}
      {member.status === "active" && seesOnlyAssigned(member) && <Pill tone="neutral">{m.team_scope_badge_assigned()}</Pill>}
    </>
  );
}
