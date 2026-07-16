import { useState } from "react";
import { useFetcher } from "react-router";
import { SegmentedControl, Select } from "@core/shared-ui";
import type { action } from "~/routes/settings-booking";

export type BookingSlotMode = "open" | "fixed";
export type BookingSlotIntervalMin = 15 | 30 | 60;

export interface BookingSlotRules {
  bookingSlotMode: BookingSlotMode;
  bookingSlotIntervalMin: BookingSlotIntervalMin;
}

const MODE_OPTIONS = [
  { value: "fixed", label: "Fixed time slots" },
  { value: "open", label: "Open schedule" },
];

const INTERVAL_OPTIONS = [
  { value: "15", label: "15 minutes" },
  { value: "30", label: "30 minutes" },
  { value: "60", label: "60 minutes" },
];

function parseInterval(raw: string): BookingSlotIntervalMin {
  const n = Number(raw);
  return n === 15 || n === 60 ? n : 30;
}

export function BookingSlotRulesPanel({ initial }: { initial: BookingSlotRules }) {
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
          Slot rules
        </h3>
        <p className="text-[12px] text-ih-fg-3 mt-1">
          Choose how bookable start times are generated from inspector availability windows.
          Defaults are Fixed time slots / 30 minutes.
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-[12px] font-bold text-ih-fg-2">Schedule mode</p>
        <SegmentedControl
          ariaLabel="Booking slot mode"
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
            ? "Starts align to each availability window’s start time, then step by the interval."
            : "Starts snap to the clock (e.g. :00 / :30) at every interval inside each window."}
        </p>
      </div>

      <div className="space-y-2 max-w-xs">
        <Select
          label="Slot interval"
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
          {saving ? "Saving..." : "Save slot rules"}
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
