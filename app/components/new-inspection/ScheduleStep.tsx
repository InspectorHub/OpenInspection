import type { useFetcher } from "react-router";
import { Banner } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

type ConflictFetcher = ReturnType<
  typeof useFetcher<{
    conflicts: Array<{ inspectionId: string; propertyAddress: string; date: string }>;
  }>
>;

type HolidayFetcher = ReturnType<
  typeof useFetcher<{
    effect: "none" | "block" | "advisory";
    name: string | null;
  }>
>;

export function ScheduleStep({
  date,
  setDate,
  time,
  setTime,
  conflictFetcher,
  holidayFetcher,
}: {
  date: string;
  setDate: (v: string) => void;
  time: string;
  setTime: (v: string) => void;
  conflictFetcher: ConflictFetcher;
  holidayFetcher: HolidayFetcher;
}) {
  const holidayEffect = holidayFetcher.data?.effect ?? "none";
  const holidayName = holidayFetcher.data?.name;

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-[12px] font-bold text-ih-fg-3 mb-1.5">{m.newinsp_schedule_date_label()}</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] focus:shadow-ih-focus outline-none" />
      </div>
      <div>
        <label className="block text-[12px] font-bold text-ih-fg-3 mb-1.5">{m.newinsp_schedule_time_label()}</label>
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] focus:shadow-ih-focus outline-none" />
      </div>
      {holidayEffect === "advisory" && holidayName && (
        <Banner tone="warn">
          {m.newinsp_schedule_holiday_advisory({ name: holidayName })}
        </Banner>
      )}
      {holidayEffect === "block" && (
        <Banner tone="danger">
          {holidayName
            ? m.newinsp_schedule_holiday_block({ name: holidayName })
            : m.newinsp_schedule_holiday_block_generic()}
        </Banner>
      )}
      {/* IA-6 — advisory conflict warning; non-blocking. With no team
          step (solo tenants) the inspection goes to the creator, and
          the conflict check covers them by default. */}
      {(conflictFetcher.data?.conflicts?.length ?? 0) > 0 && (
        <div className="rounded-md border border-ih-watch/40 bg-ih-watch-bg px-3 py-2">
          <p className="text-[12px] font-bold text-ih-watch-fg">
            <strong>{m.newinsp_conflict_title()}</strong>{" "}
            {conflictFetcher.data!.conflicts.length === 1
              ? m.newinsp_conflict_one({ address: conflictFetcher.data!.conflicts[0].propertyAddress })
              : m.newinsp_conflict_many({ count: conflictFetcher.data!.conflicts.length })}{" "}
            {m.newinsp_conflict_suffix()}
          </p>
        </div>
      )}
    </div>
  );
}
