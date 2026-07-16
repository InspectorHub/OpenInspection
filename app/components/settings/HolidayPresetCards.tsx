import { SUPPORTED_STATE_CODES } from "./holiday-region-options";

export type HolidayPresetId = "standard" | "on-call" | "off";

const PRESETS = [
  {
    id: "standard" as const,
    title: "Standard office",
    detail: "Block public booking; warn on internal schedule",
  },
  {
    id: "on-call" as const,
    title: "Holiday on-call",
    detail: "Allow with notice; require office confirmation",
  },
  {
    id: "off" as const,
    title: "Holidays off",
    detail: "No holiday catalog (legacy behavior)",
  },
] as const;

export function HolidayPresetCards({
  activePreset,
  saving,
  onSelect,
}: {
  activePreset: HolidayPresetId | null;
  saving: boolean;
  onSelect: (preset: HolidayPresetId) => void;
}) {
  return (
    <div
      data-testid="holiday-preset-row"
      className="grid grid-cols-1 sm:grid-cols-3 gap-3"
    >
      {PRESETS.map((preset) => {
        const selected = activePreset === preset.id;
        return (
          <button
            key={preset.id}
            type="button"
            data-testid={`holiday-preset-${preset.id}`}
            onClick={() => onSelect(preset.id)}
            disabled={saving}
            className={`text-left rounded-md border px-3 py-3 transition-colors ${
              selected
                ? "border-ih-primary bg-ih-primary-tint ring-2 ring-ih-primary/10"
                : "border-ih-border bg-ih-bg-card hover:bg-ih-bg-muted"
            }`}
          >
            <div className="text-[13px] font-bold text-ih-fg-1">{preset.title}</div>
            <div className="text-[11px] text-ih-fg-3 mt-1">{preset.detail}</div>
          </button>
        );
      })}
    </div>
  );
}

export function HolidayRegionPickerModal({
  open,
  onPick,
  onCancel,
}: {
  open: boolean;
  onPick: (code: string) => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ih-backdrop p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Choose holiday region"
    >
      <div className="w-full max-w-sm rounded-lg border border-ih-border bg-ih-bg-card p-4 space-y-3 shadow-ih-popover">
        <h4 className="text-[14px] font-bold text-ih-fg-1">Choose region</h4>
        <p className="text-[12px] text-ih-fg-3">
          Federal only, or federal plus a state holiday calendar.
        </p>
        <div className="space-y-1 max-h-64 overflow-y-auto">
          <button
            type="button"
            onClick={() => onPick("US")}
            className="w-full text-left px-3 py-2 rounded-md text-[13px] font-bold text-ih-fg-1 hover:bg-ih-bg-muted"
          >
            Federal only (US)
          </button>
          {SUPPORTED_STATE_CODES.map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => onPick(code)}
              className="w-full text-left px-3 py-2 rounded-md text-[13px] font-bold text-ih-fg-1 hover:bg-ih-bg-muted"
            >
              Federal + {code}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="text-[12px] font-bold text-ih-fg-3 hover:underline"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
