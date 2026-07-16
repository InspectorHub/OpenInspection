export type HolidayPublicPolicy = "open" | "block" | "advisory";

export interface ClosedDate {
  date: string;
  name: string;
}

const PUBLIC_POLICY_LABELS: Record<HolidayPublicPolicy, string> = {
  block: "Blocked",
  advisory: "Allowed with notice",
  open: "Allowed",
};

function publicPolicyLabel(policy: HolidayPublicPolicy): string {
  return PUBLIC_POLICY_LABELS[policy];
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
  return (
    <section
      className="bg-ih-bg-muted border border-ih-border rounded-lg px-4 py-3 space-y-2"
      data-testid="company-closed-strip"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-[13px] font-bold text-ih-fg-1">Company closed days</h3>
        <p className="text-[12px] text-ih-fg-3">
          Public booking:{" "}
          <span className="font-bold text-ih-fg-2">{publicPolicyLabel(holidayPublicPolicy)}</span>
          <span className="text-ih-fg-4"> · {holidayRegion}</span>
        </p>
      </div>
      {upcomingClosed.length > 0 ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {upcomingClosed.map((day) => (
            <li key={day.date} className="text-[12px] text-ih-fg-2">
              <span className="font-bold">{day.date}</span>
              <span className="text-ih-fg-3"> — {day.name}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12px] text-ih-fg-4 italic">No upcoming closed dates in the next year.</p>
      )}
      <p className="text-[11px] text-ih-fg-4">
        Company holidays are set by an owner under Online Booking. You cannot edit them here.
      </p>
    </section>
  );
}
