/**
 * <DateRangePicker> — the window control on /metrics.
 *
 * It replaced a three-button `3m · 6m · 12m` group. That control had two
 * problems and no way to grow: "3m" is the system's own shorthand rather than
 * anything a reader says, and the three windows it offered were the only three
 * questions the page could answer — "how did last week go?" was unaskable.
 *
 * Shape: one trigger that states the window in words plus the dates it resolves
 * to, opening a panel of named presets with a custom range beneath them. The
 * presets are the questions people actually ask; the two date fields are the
 * escape hatch, not the primary path, so they sit below a rule rather than
 * competing with the list.
 *
 * Built from <Popover> and <Button> plus native `type="date"` inputs — the same
 * idiom the dashboard's FiltersDrawer already uses. A hand-rolled calendar grid
 * would be a second date-entry vocabulary in one product, and the native
 * control brings keyboard entry, locale formatting and mobile pickers for free.
 *
 * lint:ds — `ih-*` tokens only.
 */
import { useRef, useState } from "react";
import { Button, Popover } from "@core/shared-ui";
import { m } from "~/paraglide/messages";
import {
  formatRange,
  matchPreset,
  presetRange,
  PRESET_IDS,
  type MetricsRange,
  type PresetId,
} from "~/lib/metrics-range";

interface DateRangePickerProps {
  range: MetricsRange;
  /** Civil today in the viewer's zone — presets resolve against it. */
  today: string;
  locale: string;
  onChange: (range: MetricsRange) => void;
}

function presetLabel(id: PresetId): string {
  switch (id) {
    case "7d":  return m.metrics_range_7d();
    case "14d": return m.metrics_range_14d();
    case "30d": return m.metrics_range_30d();
    case "3m":  return m.metrics_range_3m();
    case "6m":  return m.metrics_range_6m();
    case "12m": return m.metrics_range_12m();
    case "ytd": return m.metrics_range_ytd();
  }
}

export function DateRangePicker({ range, today, locale, onChange }: DateRangePickerProps) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  // Custom fields are local until both ends are valid, so typing a start date
  // does not fire a request against a half-entered window.
  const [draftFrom, setDraftFrom] = useState(range.from);
  const [draftTo, setDraftTo] = useState(range.to);

  const active = matchPreset(range, today);

  const openPanel = () => {
    setDraftFrom(range.from);
    setDraftTo(range.to);
    setOpen(true);
  };

  const choosePreset = (id: PresetId) => {
    onChange(presetRange(id, today));
    setOpen(false);
  };

  const applyCustom = () => {
    if (!draftFrom || !draftTo) return;
    onChange(draftFrom <= draftTo ? { from: draftFrom, to: draftTo } : { from: draftTo, to: draftFrom });
    setOpen(false);
  };

  const triggerLabel = active ? presetLabel(active) : m.metrics_range_custom();

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openPanel())}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex items-center gap-2 h-9 pl-3 pr-2.5 rounded-lg border border-ih-border bg-ih-bg-card text-left hover:border-ih-border-strong transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ih-primary"
      >
        <svg className="w-4 h-4 shrink-0 text-ih-fg-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <rect x="2" y="3" width="12" height="11" rx="2" />
          <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" />
        </svg>
        <span className="flex flex-col leading-tight">
          <span className="text-[12px] font-bold text-ih-fg-1">{triggerLabel}</span>
          <span className="text-[10px] text-ih-fg-4 tabular-nums">{formatRange(range, locale)}</span>
        </span>
        <svg className="w-3 h-3 shrink-0 text-ih-fg-4" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path d="M3 4.5 6 7.5 9 4.5" />
        </svg>
      </button>

      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchorRef}>
        {/* Width is set by the longest row — "Last 12 months" beside
            "Jul 29, 2025 – Jul 29, 2026", the only preset whose span crosses a
            year and so prints both. At w-64 that label wrapped to two lines and
            broke the list's rhythm. */}
        <div className="w-[21rem] p-2" role="dialog" aria-label={m.metrics_range_aria()}>
          <ul className="space-y-0.5">
            {PRESET_IDS.map((id) => {
              const isActive = id === active;
              return (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => choosePreset(id)}
                    aria-current={isActive || undefined}
                    className={`w-full flex items-baseline justify-between gap-3 px-2.5 py-1.5 rounded-md text-left text-[13px] transition-colors ${
                      isActive
                        ? "bg-ih-bg-muted font-semibold text-ih-fg-1"
                        : "text-ih-fg-2 hover:bg-ih-bg-muted hover:text-ih-fg-1"
                    }`}
                  >
                    <span className="whitespace-nowrap">{presetLabel(id)}</span>
                    <span className="text-[11px] text-ih-fg-4 tabular-nums shrink-0">
                      {formatRange(presetRange(id, today), locale)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="mt-2 pt-2 border-t border-ih-border">
            <p className="px-2.5 pb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-ih-fg-4">
              {m.metrics_range_custom_heading()}
            </p>
            <div className="px-2.5 flex items-center gap-2">
              <label className="flex-1">
                <span className="sr-only">{m.metrics_range_from()}</span>
                <input
                  type="date"
                  value={draftFrom}
                  max={draftTo || today}
                  onChange={(e) => setDraftFrom(e.target.value)}
                  className="w-full h-8 px-2 rounded-md border border-ih-border bg-ih-bg-card text-[12px] text-ih-fg-1 outline-none focus:border-ih-primary"
                />
              </label>
              <span className="text-ih-fg-4 text-[12px]" aria-hidden="true">–</span>
              <label className="flex-1">
                <span className="sr-only">{m.metrics_range_to()}</span>
                <input
                  type="date"
                  value={draftTo}
                  min={draftFrom || undefined}
                  onChange={(e) => setDraftTo(e.target.value)}
                  className="w-full h-8 px-2 rounded-md border border-ih-border bg-ih-bg-card text-[12px] text-ih-fg-1 outline-none focus:border-ih-primary"
                />
              </label>
            </div>
            <div className="px-2.5 pt-2">
              <Button size="sm" variant="primary" className="w-full" onClick={applyCustom} disabled={!draftFrom || !draftTo}>
                {m.metrics_range_apply()}
              </Button>
            </div>
          </div>
        </div>
      </Popover>
    </>
  );
}
