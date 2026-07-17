import { isAdminRole } from "~/lib/access";
import type { CalendarScope } from "~/components/calendar/calendar-helpers";
import type { CalendarMember } from "~/components/calendar/BlockTimeDrawer";
import { m } from "~/paraglide/messages";

export interface CalendarScopeToolbarProps {
  scope: CalendarScope;
  role: string;
  members: CalendarMember[];
  selectedUserIds: string[];
  onScopeChange: (scope: CalendarScope) => void;
  onToggleMember: (memberId: string) => void;
}

/**
 * My | Team scope control for the calendar page.
 * Team chips appear only when the caller can manage the company calendar.
 */
export function CalendarScopeToolbar({
  scope,
  role,
  members,
  selectedUserIds,
  onScopeChange,
  onToggleMember,
}: CalendarScopeToolbarProps) {
  const canManageTeam = isAdminRole(role);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="inline-flex rounded-md border border-ih-border bg-ih-bg-card p-1" aria-label={m.calendar_scope_aria()}>
        <button
          type="button"
          onClick={() => onScopeChange("my")}
          aria-pressed={scope === "my"}
          className={`h-8 rounded px-3 text-[13px] font-bold ${
            scope === "my" ? "bg-ih-primary text-white" : "text-ih-fg-3 hover:bg-ih-bg-muted"
          }`}
        >
          {m.calendar_scope_my()}
        </button>
        {canManageTeam && (
          <button
            type="button"
            onClick={() => onScopeChange("team")}
            aria-pressed={scope === "team"}
            className={`h-8 rounded px-3 text-[13px] font-bold ${
              scope === "team" ? "bg-ih-primary text-white" : "text-ih-fg-3 hover:bg-ih-bg-muted"
            }`}
          >
            {m.calendar_scope_team()}
          </button>
        )}
      </div>

      {scope === "team" && canManageTeam && (
        <div className="flex flex-wrap gap-2" aria-label={m.calendar_scope_inspectors_aria()}>
          {members.map((member) => {
            const selected = selectedUserIds.includes(member.id);
            return (
              <button
                key={member.id}
                type="button"
                onClick={() => onToggleMember(member.id)}
                aria-pressed={selected}
                className={`h-8 rounded-full border px-3 text-[12px] font-bold ${
                  selected
                    ? "border-ih-primary bg-ih-primary-tint text-ih-primary"
                    : "border-ih-border bg-ih-bg-card text-ih-fg-3 hover:bg-ih-bg-muted"
                }`}
              >
                {member.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
