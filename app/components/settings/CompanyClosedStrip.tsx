import { formatDate } from "~/lib/format";
import { useDisplayLocale } from "~/hooks/useSessionContext";
import { m } from "~/paraglide/messages";

export type HolidayPublicPolicy = "open" | "block" | "advisory";

export interface ClosedDate {
  date: string;
  name: string;
}

function publicPolicyLabel(policy: HolidayPublicPolicy): string {
  const labels: Record<HolidayPublicPolicy, string> = {
    block: m.settings_closed_policy_blocked(),
    advisory: m.settings_closed_policy_advisory(),
    open: m.settings_closed_policy_allowed(),
  };
  return labels[policy];
}

export function CompanyClosedStrip({
  holidayRegion,
  holidayPublicPolicy,
  upcomingClosed,
}: {
  holidayRegion: string;
  holidayPublicPolicy: HolidayPublicPolicy;
  upcomingClosed: ClosedDate[];
}) {
  const locale = useDisplayLocale();
  return (
    <section
      className="bg-ih-bg-muted border border-ih-border rounded-lg px-4 py-3 space-y-2"
      data-testid="company-closed-strip"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-[13px] font-bold text-ih-fg-1">{m.settings_closed_heading()}</h3>
        <p className="text-[12px] text-ih-fg-3">
          {m.settings_closed_public_booking()}{" "}
          <span className="font-bold text-ih-fg-2">{publicPolicyLabel(holidayPublicPolicy)}</span>
          <span className="text-ih-fg-4"> · {holidayRegion}</span>
        </p>
      </div>
      {upcomingClosed.length > 0 ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {upcomingClosed.map((day) => (
            <li key={day.date} className="text-[12px] text-ih-fg-2">
              <span className="font-bold">{formatDate(day.date, { locale, timeZone: "UTC" })}</span>
              <span className="text-ih-fg-3"> — {day.name}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12px] text-ih-fg-4 italic">{m.settings_closed_none_upcoming()}</p>
      )}
      <p className="text-[11px] text-ih-fg-4">
        {m.settings_closed_owner_note()}
      </p>
    </section>
  );
}
