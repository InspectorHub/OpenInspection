import { useNavigate } from "react-router";
import { m } from "~/paraglide/messages";

export interface SchedulingMember {
  id: string;
  email: string;
  role: string;
  createdAt: string;
}

/**
 * Admin-only switch for whose schedule the page is editing. Navigates rather
 * than holding state so the choice survives a reload and can be linked to —
 * `?inspectorId=` is what the loader reads.
 */
export function ManageOthersPicker({
  members,
  managedInspectorId,
}: {
  members: SchedulingMember[];
  managedInspectorId: string | null;
}) {
  const navigate = useNavigate();
  return (
    <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 flex items-center gap-3">
      <span className="text-[13px] font-bold text-ih-fg-1">{m.settings_schedule_managing_for()}</span>
      <select
        value={managedInspectorId ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          navigate(v ? `/settings/schedule?inspectorId=${v}` : "/settings/schedule");
        }}
        className="h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
      >
        <option value="">{m.settings_schedule_myself()}</option>
        {members.map((member) => (
          <option key={member.id} value={member.id}>
            {member.email}
          </option>
        ))}
      </select>
    </section>
  );
}
