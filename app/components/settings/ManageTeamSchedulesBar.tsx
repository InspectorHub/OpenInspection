import { Link } from "react-router";
import { m } from "~/paraglide/messages";

export function ManageTeamSchedulesBar({
  members,
}: {
  members: { id: string; email: string }[];
}) {
  return (
    <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <h3 className="text-[13px] font-bold text-ih-fg-1">{m.settings_teamsched_heading()}</h3>
        <p className="text-[12px] text-ih-fg-3 mt-1">
          {m.settings_teamsched_desc()}
          {members.length > 0 ? m.settings_teamsched_members_count({ count: members.length }) : ""}.
        </p>
        {members.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
            {members.map((member) => (
              <li key={member.id}>
                <Link
                  to={`/settings/schedule?inspectorId=${encodeURIComponent(member.id)}`}
                  className="text-[12px] text-ih-primary hover:underline"
                >
                  {member.email}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Link
        to="/settings/schedule"
        className="h-9 px-4 inline-flex items-center rounded-md bg-ih-primary text-white font-bold text-[12px] hover:bg-ih-primary-600 transition-colors shrink-0"
      >
        {m.settings_teamsched_manage()}
      </Link>
    </section>
  );
}
