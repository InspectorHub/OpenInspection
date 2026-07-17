import { Banner, SegmentedControl, Select } from "@core/shared-ui";
import type { CustomHoliday, HolidayInternalPolicy, HolidayPublicPolicy } from "./HolidayClosedPanel";
import { SUPPORTED_STATE_CODES } from "./holiday-region-options";
import { m } from "~/paraglide/messages";

export function HolidayAdvancedDetails({
  region,
  setRegion,
  publicPolicy,
  setPublicPolicy,
  internalPolicy,
  setInternalPolicy,
  customHolidays,
  newDate,
  setNewDate,
  newName,
  setNewName,
  onRegionEnableDefaults,
  onDirty,
  onAddCustom,
  onRemoveCustom,
  onSave,
  saving,
  saved,
  failed,
  failMessage,
}: {
  region: string | null;
  setRegion: (v: string | null) => void;
  publicPolicy: HolidayPublicPolicy;
  setPublicPolicy: (v: HolidayPublicPolicy) => void;
  internalPolicy: HolidayInternalPolicy;
  setInternalPolicy: (v: HolidayInternalPolicy) => void;
  customHolidays: CustomHoliday[];
  newDate: string;
  setNewDate: (v: string) => void;
  newName: string;
  setNewName: (v: string) => void;
  onRegionEnableDefaults: () => void;
  onDirty: () => void;
  onAddCustom: () => void;
  onRemoveCustom: (id: string) => void;
  onSave: () => void;
  saving: boolean;
  saved: boolean;
  failed: boolean;
  failMessage?: string;
}) {
  const PUBLIC_OPTIONS = [
    { value: "block", label: m.settings_holiday_public_block() },
    { value: "advisory", label: m.settings_holiday_public_advisory() },
    { value: "open", label: m.settings_holiday_public_open() },
  ];

  const INTERNAL_OPTIONS = [
    { value: "advisory", label: m.settings_holiday_internal_warn() },
    { value: "block", label: m.settings_holiday_internal_block() },
  ];

  const REGION_OPTIONS = [
    { value: "US", label: m.settings_holiday_region_federal_only() },
    ...SUPPORTED_STATE_CODES.map((code) => ({
      value: `US-${code}`,
      label: m.settings_holiday_region_federal_plus({ code }),
    })),
  ];

  return (
    <details data-testid="holiday-advanced" className="rounded-md border border-ih-border">
      <summary className="cursor-pointer px-3 py-2 text-[12px] font-bold text-ih-fg-2 select-none">
        {m.settings_holiday_advanced_summary()}
      </summary>
      <div className="border-t border-ih-border px-3 py-4 space-y-4">
        <div className="space-y-2 max-w-sm">
          <Select
            label={m.settings_holiday_region_label()}
            options={[
              { value: "", label: m.settings_holiday_region_off() },
              ...REGION_OPTIONS,
            ]}
            value={region ?? ""}
            onChange={(e) => {
              const v = e.target.value || null;
              setRegion(v);
              if (v) onRegionEnableDefaults();
              onDirty();
            }}
          />
        </div>

        <div className="space-y-2" data-testid="holiday-public-policy-advanced">
          <p className="text-[12px] font-bold text-ih-fg-2">{m.settings_holiday_public_heading()}</p>
          <SegmentedControl
            ariaLabel={m.settings_holiday_public_aria()}
            size="md"
            options={PUBLIC_OPTIONS}
            value={publicPolicy}
            onChange={(v) => {
              setPublicPolicy(v as HolidayPublicPolicy);
              onDirty();
            }}
          />
          {region && publicPolicy === "open" && (
            <Banner tone="warn">
              {m.settings_holiday_open_warning()}
            </Banner>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-[12px] font-bold text-ih-fg-2">{m.settings_holiday_internal_heading()}</p>
          <SegmentedControl
            ariaLabel={m.settings_holiday_internal_aria()}
            size="md"
            options={INTERNAL_OPTIONS}
            value={internalPolicy}
            onChange={(v) => {
              setInternalPolicy(v as HolidayInternalPolicy);
              onDirty();
            }}
          />
        </div>

        <div className="space-y-2">
          <p className="text-[12px] font-bold text-ih-fg-2">{m.settings_holiday_custom_heading()}</p>
          <ul className="space-y-1">
            {customHolidays.map((h) => (
              <li
                key={h.id}
                className="flex items-center justify-between gap-2 text-[13px] text-ih-fg-2"
              >
                <span>
                  <span className="font-medium tabular-nums">{h.date}</span>
                  {" — "}
                  {h.name}
                </span>
                <button
                  type="button"
                  onClick={() => onRemoveCustom(h.id)}
                  className="text-[12px] font-bold text-ih-bad-fg hover:underline"
                >
                  {m.common_remove()}
                </button>
              </li>
            ))}
            {customHolidays.length === 0 && (
              <li className="text-[12px] text-ih-fg-3">{m.settings_holiday_custom_none()}</li>
            )}
          </ul>
          <div className="flex flex-wrap items-end gap-2 pt-1">
            <label className="block">
              <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">
                {m.settings_holiday_custom_date()}
              </span>
              <input
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className="mt-1 block h-8 px-2 rounded-md border border-ih-border bg-ih-bg-card text-[13px]"
              />
            </label>
            <label className="block flex-1 min-w-[8rem]">
              <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">
                {m.settings_holiday_custom_name()}
              </span>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="mt-1 block w-full h-8 px-2 rounded-md border border-ih-border bg-ih-bg-card text-[13px]"
                placeholder={m.settings_holiday_custom_name_placeholder()}
              />
            </label>
            <button
              type="button"
              onClick={onAddCustom}
              disabled={saving || !newDate || !newName.trim()}
              className="h-8 px-3 rounded-md border border-ih-border text-[12px] font-bold text-ih-fg-2 hover:bg-ih-bg-muted disabled:opacity-50"
            >
              {m.common_add()}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-1">
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="h-8 px-3 rounded-md bg-ih-primary text-white font-bold text-[12px] hover:bg-ih-primary-600 transition-colors disabled:opacity-50"
          >
            {saving ? m.settings_holiday_save_pending() : m.settings_holiday_save()}
          </button>
          {saved && <span className="text-[13px] text-ih-ok-fg font-bold">{m.settings_holiday_saved()}</span>}
          {failed && (
            <span className="text-[13px] text-ih-bad-fg font-bold">
              {failMessage ?? m.settings_holiday_save_failed()}
            </span>
          )}
        </div>
      </div>
    </details>
  );
}
