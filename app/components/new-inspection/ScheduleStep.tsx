import type { useFetcher } from "react-router";
import { Banner } from "@core/shared-ui";

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
        <label className="block text-[12px] font-bold text-ih-fg-3 mb-1.5">Date</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] focus:shadow-ih-focus outline-none" />
      </div>
      <div>
        <label className="block text-[12px] font-bold text-ih-fg-3 mb-1.5">Time</label>
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] focus:shadow-ih-focus outline-none" />
      </div>
      {holidayEffect === "advisory" && holidayName && (
        <Banner tone="warn">
          Scheduling on {holidayName}. You can still save this inspection.
        </Banner>
      )}
      {holidayEffect === "block" && (
        <Banner tone="danger">
          {holidayName
            ? `Cannot schedule on ${holidayName} — company holidays are blocked.`
            : "Cannot schedule on a company closed day."}
        </Banner>
      )}
      {/* IA-6 — advisory conflict warning; non-blocking. With no team
          step (solo tenants) the inspection goes to the creator, and
          the conflict check covers them by default. */}
      {(conflictFetcher.data?.conflicts?.length ?? 0) > 0 && (
        <div className="rounded-md border border-ih-watch/40 bg-ih-watch-bg px-3 py-2">
          <p className="text-[12px] font-bold text-ih-watch-fg">
            <strong>Schedule conflict:</strong>{" "}
            {conflictFetcher.data!.conflicts.length === 1
              ? `this inspector already has an inspection at ${conflictFetcher.data!.conflicts[0].propertyAddress}`
              : `this inspector already has ${conflictFetcher.data!.conflicts.length} inspections`}{" "}
            in this time slot. You can still schedule it.
          </p>
        </div>
      )}
    </div>
  );
}
