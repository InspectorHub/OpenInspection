import { Link } from "react-router";
import { Button } from "@core/shared-ui";
import { isAdminRole } from "~/lib/access";
import { useCapability } from "~/hooks/useSessionContext";
import type { CalendarScope } from "~/components/calendar/calendar-helpers";
import type { CalendarMember } from "~/components/calendar/BlockTimeDrawer";
import { InspectorSyncBadge } from "~/components/calendar/InspectorSyncBadge";
import { m } from "~/paraglide/messages";

export interface CalendarScopeToolbarProps {
  scope: CalendarScope;
  role: string;
  members: CalendarMember[];
  selectedUserIds: string[];
  onScopeChange: (scope: CalendarScope) => void;
  onToggleMember: (memberId: string) => void;
  locale: string;
  /** Injected by tests; production reads the clock at render time. */
  now?: number;
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
  locale,
  now,
}: CalendarScopeToolbarProps) {
  const canManageTeam = isAdminRole(role);
  // The cross-link is gated on the CAPABILITY, not on canManageTeam:
  // /calendar/dispatch is guarded by `scheduleOthers`, so a role-tier button
  // would offer a manager whose override was revoked a page that redirects
  // straight back here. The existing canManageTeam uses stay as they are —
  // reconciling /api/calendar/items with the capability is a separate gap.
  const canDispatch = useCapability("scheduleOthers");

  return (
    <div className="flex flex-wrap items-center gap-3">
      {canDispatch && scope === "team" && (
        <Link to="/calendar/dispatch" className="order-last ml-auto" data-testid="calendar-open-dispatch">
          <Button variant="secondary" size="sm">{m.calendar_open_dispatch()}</Button>
        </Link>
      )}
      <div className="inline-flex rounded-md border border-ih-border bg-ih-bg-card p-1" aria-label={m.calendar_scope_aria()}>
        <button
          type="button"
          onClick={() => onScopeChange("my")}
          aria-pressed={scope === "my"}
          className={`h-8 rounded px-3 text-[13px] font-bold ${
            scope === "my" ? "bg-ih-primary text-ih-fg-inverse" : "text-ih-fg-3 hover:bg-ih-bg-muted"
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
              scope === "team" ? "bg-ih-primary text-ih-fg-inverse" : "text-ih-fg-3 hover:bg-ih-bg-muted"
            }`}
          >
            {m.calendar_scope_team()}
          </button>
        )}
      </div>

      {scope === "team" && canManageTeam && (
        // Wider gap BETWEEN members than the gap-1 tying each chip to its own
        // sync badge, so a scanned row reads as [chip badge] [chip badge] rather
        // than an ambiguous run of equally-spaced pills.
        <div className="flex flex-wrap gap-x-5 gap-y-2" aria-label={m.calendar_scope_inspectors_aria()}>
          {members.map((member) => {
            const selected = selectedUserIds.includes(member.id);
            return (
              // The badge sits outside the button so its label does not become
              // part of the chip's accessible name.
              <span key={member.id} className="inline-flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onToggleMember(member.id)}
                  aria-pressed={selected}
                  className={`h-8 rounded-full border px-3 text-[12px] font-bold ${
                    selected
                      ? "border-ih-primary bg-ih-primary-tint text-ih-primary-text"
                      : "border-ih-border bg-ih-bg-card text-ih-fg-3 hover:bg-ih-bg-muted"
                  }`}
                >
                  {member.name}
                </button>
                <InspectorSyncBadge
                  connected={member.calendarConnected ?? false}
                  lastSyncAt={member.calendarLastSyncAt ?? null}
                  locale={locale}
                  {...(now === undefined ? {} : { now })}
                />
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
