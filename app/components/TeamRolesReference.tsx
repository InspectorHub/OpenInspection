import { Card } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

/** The roles and what each is for, shown beneath the `/team` roster. */
export function TeamRolesReference() {
  const roles = [
    { role: m.settings_team_role_owner_name(), desc: m.settings_team_role_owner_desc() },
    { role: m.settings_team_role_manager_name(), desc: m.settings_team_role_manager_desc() },
    { role: m.settings_team_role_inspector_name(), desc: m.settings_team_role_inspector_desc() },
    { role: m.settings_team_role_staff_name(), desc: m.settings_team_role_staff_desc() },
    { role: m.settings_team_role_agent_name(), desc: m.settings_team_role_agent_desc() },
  ];
  return (
    <Card className="p-6">
      <h2 className="text-sm font-bold text-ih-fg-1 mb-3">{m.settings_team_roles_heading()}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {roles.map((r) => (
          <div key={r.role} className="p-3 border border-ih-border rounded-md">
            <p className="text-[13px] font-bold text-ih-fg-1">{r.role}</p>
            <p className="text-[12px] text-ih-fg-3 mt-0.5">{r.desc}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}
