import { useState } from "react";
import { useFetcher } from "react-router";
import type { action } from "~/routes/settings-schedule";

interface AvailabilitySlot {
  id: number;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface DayState {
  enabled: boolean;
  startTime: string;
  endTime: string;
}

/** Mon–Fri 08:00–17:00 draft when the inspector has never saved weekly hours. */
function defaultDraftDays(): DayState[] {
  return Array.from({ length: 7 }, (_, dayOfWeek) => ({
    enabled: dayOfWeek >= 1 && dayOfWeek <= 5,
    startTime: "08:00",
    endTime: "17:00",
  }));
}

function buildDayMap(slots: AvailabilitySlot[]): DayState[] {
  if (slots.length === 0) return defaultDraftDays();

  const days: DayState[] = Array.from({ length: 7 }, () => ({
    enabled: false,
    startTime: "08:00",
    endTime: "17:00",
  }));
  for (const s of slots) {
    days[s.dayOfWeek] = { enabled: true, startTime: s.startTime, endTime: s.endTime };
  }
  return days;
}

export function WeeklySchedulePanel({
  initialSlots,
  inspectorId,
}: {
  initialSlots: AvailabilitySlot[];
  inspectorId: string | null | undefined;
}) {
  const fetcher = useFetcher<typeof action>();
  const [days, setDays] = useState<DayState[]>(() => buildDayMap(initialSlots));
  // dirty tracks whether local state differs from the last saved state
  const [dirty, setDirty] = useState(false);

  // Derive saved from fetcher response; reset dirty when the save completes
  const saved =
    fetcher.state === "idle" &&
    fetcher.data?.intent === "schedule-save" &&
    fetcher.data.ok === true &&
    !dirty;

  const failed =
    fetcher.state === "idle" &&
    fetcher.data?.intent === "schedule-save" &&
    fetcher.data.ok === false &&
    !dirty;

  const saving = fetcher.state !== "idle";

  function updateDay(idx: number, patch: Partial<DayState>) {
    setDays((prev) => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
    setDirty(true);
  }

  function handleSave() {
    const slots = days
      .map((d, i) => (d.enabled ? { dayOfWeek: i, startTime: d.startTime, endTime: d.endTime } : null))
      .filter(Boolean);
    setDirty(false);
    fetcher.submit(
      {
        intent: "schedule-save",
        slots: JSON.stringify(slots),
        ...(inspectorId ? { inspectorId } : {}),
      },
      { method: "post" },
    );
  }

  const displayOrder = [1, 2, 3, 4, 5, 6, 0];

  return (
    <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-4">
      <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">Weekly schedule</h3>
      <div className="space-y-2">
        {displayOrder.map((dow) => (
          <div key={dow} className="flex items-center gap-3">
            <label className="flex items-center gap-2 w-28 shrink-0 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={days[dow].enabled}
                onChange={(e) => updateDay(dow, { enabled: e.target.checked })}
                className="h-4 w-4 rounded border-ih-border text-ih-primary"
              />
              <span className="text-[13px] font-bold text-ih-fg-1">{DAY_LABELS[dow]}</span>
            </label>
            {days[dow].enabled ? (
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  value={days[dow].startTime}
                  onChange={(e) => updateDay(dow, { startTime: e.target.value })}
                  className="px-2 py-1.5 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
                />
                <span className="text-[12px] text-ih-fg-3">to</span>
                <input
                  type="time"
                  value={days[dow].endTime}
                  onChange={(e) => updateDay(dow, { endTime: e.target.value })}
                  className="px-2 py-1.5 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
                />
              </div>
            ) : (
              <span className="text-[12px] text-ih-fg-4 italic">Unavailable</span>
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="h-8 px-3 rounded-md bg-ih-primary text-white font-bold text-[12px] hover:bg-ih-primary-600 transition-colors disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save schedule"}
        </button>
        {saved && <span className="text-[13px] text-ih-ok-fg font-bold">Saved.</span>}
        {failed && (
          <span className="text-[13px] text-ih-bad-fg font-bold">
            {fetcher.data?.message ?? "Save failed. Please try again."}
          </span>
        )}
      </div>
    </section>
  );
}
