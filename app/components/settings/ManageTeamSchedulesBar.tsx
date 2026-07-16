import { Link } from "react-router";

export function ManageTeamSchedulesBar({
  members,
}: {
  members: { id: string; email: string }[];
}) {
  return (
    <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <h3 className="text-[13px] font-bold text-ih-fg-1">Team schedules</h3>
        <p className="text-[12px] text-ih-fg-3 mt-1">
          Weekly hours and time off live under My Schedule
          {members.length > 0 ? ` (${members.length} schedulable members)` : ""}.
        </p>
        {members.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
            {members.map((m) => (
              <li key={m.id}>
                <Link
                  to={`/settings/schedule?inspectorId=${encodeURIComponent(m.id)}`}
                  className="text-[12px] text-ih-primary hover:underline"
                >
                  {m.email}
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
        Manage team schedules →
      </Link>
    </section>
  );
}
