import { useState } from "react";
import { useFetcher } from "react-router";
import { SegmentedControl, Select } from "@core/shared-ui";
import type { action } from "~/routes/settings-booking";
import { m } from "~/paraglide/messages";

export type BookingSlotMode = "open" | "fixed";
export type BookingSlotIntervalMin = 15 | 30 | 60;

export interface BookingSlotRules {
  bookingSlotMode: BookingSlotMode;
  bookingSlotIntervalMin: BookingSlotIntervalMin;
}

function parseInterval(raw: string): BookingSlotIntervalMin {
  const n = Number(raw);
  return n === 15 || n === 60 ? n : 30;
}

export function BookingSlotRulesPanel({ initial }: { initial: BookingSlotRules }) {
  const MODE_OPTIONS = [
    { value: "fixed", label: m.settings_slotrules_mode_fixed() },
    { value: "open", label: m.settings_slotrules_mode_open() },
  ];

  const INTERVAL_OPTIONS = [
    { value: "15", label: m.settings_slotrules_interval_15() },
    { value: "30", label: m.settings_slotrules_interval_30() },
    { value: "60", label: m.settings_slotrules_interval_60() },
  ];

  const fetcher = useFetcher<typeof action>();
  const [mode, setMode] = useState<BookingSlotMode>(initial.bookingSlotMode);
  const [intervalMin, setIntervalMin] = useState<BookingSlotIntervalMin>(
    initial.bookingSlotIntervalMin,
  );
  const [dirty, setDirty] = useState(false);

  const saving = fetcher.state !== "idle";
  const saved =
    fetcher.state === "idle" &&
    fetcher.data?.intent === "slot-rules-save" &&
    fetcher.data.ok === true &&
    !dirty;
  const failed =
    fetcher.state === "idle" &&
    fetcher.data?.intent === "slot-rules-save" &&
    fetcher.data.ok === false &&
    !dirty;

  function handleSave() {
    setDirty(false);
    fetcher.submit(
      {
        intent: "slot-rules-save",
        bookingSlotMode: mode,
        bookingSlotIntervalMin: String(intervalMin),
      },
      { method: "post" },
    );
  }

  return (
    <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-4">
      <div>
        <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">
          {m.settings_slotrules_heading()}
        </h3>
        <p className="text-[12px] text-ih-fg-3 mt-1">
          {m.settings_slotrules_desc()}
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-[12px] font-bold text-ih-fg-2">{m.settings_slotrules_mode_label()}</p>
        <SegmentedControl
          ariaLabel={m.settings_slotrules_mode_aria()}
          size="md"
          options={MODE_OPTIONS}
          value={mode}
          onChange={(v) => {
            setMode(v === "open" ? "open" : "fixed");
            setDirty(true);
          }}
        />
        <p className="text-[11px] text-ih-fg-3">
          {mode === "fixed"
            ? m.settings_slotrules_fixed_desc()
            : m.settings_slotrules_open_desc()}
        </p>
      </div>

      <div className="space-y-2 max-w-xs">
        <Select
          label={m.settings_slotrules_interval_label()}
          options={INTERVAL_OPTIONS}
          value={String(intervalMin)}
          onChange={(e) => {
            setIntervalMin(parseInterval(e.target.value));
            setDirty(true);
          }}
        />
      </div>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="h-8 px-3 rounded-md bg-ih-primary text-white font-bold text-[12px] hover:bg-ih-primary-600 transition-colors disabled:opacity-50"
        >
          {saving ? m.settings_holiday_save_pending() : m.settings_slotrules_save()}
        </button>
        {saved && <span className="text-[13px] text-ih-ok-fg font-bold">{m.settings_holiday_saved()}</span>}
        {failed && (
          <span className="text-[13px] text-ih-bad-fg font-bold">
            {fetcher.data?.message ?? m.settings_holiday_save_failed()}
          </span>
        )}
      </div>
    </section>
  );
}
