import { Banner, SegmentedControl, Select } from "@core/shared-ui";
import type { CustomHoliday, HolidayInternalPolicy, HolidayPublicPolicy } from "./HolidayClosedPanel";
import { SUPPORTED_STATE_CODES } from "./holiday-region-options";

const PUBLIC_OPTIONS = [
  { value: "block", label: "Block bookings" },
  { value: "advisory", label: "Allow with notice" },
  { value: "open", label: "Allow bookings" },
];

const INTERNAL_OPTIONS = [
  { value: "advisory", label: "Warn only" },
  { value: "block", label: "Block" },
];

const REGION_OPTIONS = [
  { value: "US", label: "Federal only (US)" },
  ...SUPPORTED_STATE_CODES.map((code) => ({
    value: `US-${code}`,
    label: `Federal + ${code}`,
  })),
];

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
  return (
    <details data-testid="holiday-advanced" className="rounded-md border border-ih-border">
      <summary className="cursor-pointer px-3 py-2 text-[12px] font-bold text-ih-fg-2 select-none">
        Advanced
      </summary>
      <div className="border-t border-ih-border px-3 py-4 space-y-4">
        <div className="space-y-2 max-w-sm">
          <Select
            label="Holiday region"
            options={[
              { value: "", label: "Off (no holiday catalog)" },
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
          <p className="text-[12px] font-bold text-ih-fg-2">Public booking</p>
          <SegmentedControl
            ariaLabel="Public holiday policy"
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
              Customers can still book on listed holidays (e.g. Thanksgiving). Use Block
              or Allow with notice if that is not intended.
            </Banner>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-[12px] font-bold text-ih-fg-2">Internal scheduling</p>
          <SegmentedControl
            ariaLabel="Internal holiday policy"
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
          <p className="text-[12px] font-bold text-ih-fg-2">Custom closed days</p>
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
                  Remove
                </button>
              </li>
            ))}
            {customHolidays.length === 0 && (
              <li className="text-[12px] text-ih-fg-3">No custom days yet.</li>
            )}
          </ul>
          <div className="flex flex-wrap items-end gap-2 pt-1">
            <label className="block">
              <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">
                Date
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
                Name
              </span>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="mt-1 block w-full h-8 px-2 rounded-md border border-ih-border bg-ih-bg-card text-[13px]"
                placeholder="Company picnic"
              />
            </label>
            <button
              type="button"
              onClick={onAddCustom}
              disabled={saving || !newDate || !newName.trim()}
              className="h-8 px-3 rounded-md border border-ih-border text-[12px] font-bold text-ih-fg-2 hover:bg-ih-bg-muted disabled:opacity-50"
            >
              Add
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
            {saving ? "Saving..." : "Save holiday settings"}
          </button>
          {saved && <span className="text-[13px] text-ih-ok-fg font-bold">Saved.</span>}
          {failed && (
            <span className="text-[13px] text-ih-bad-fg font-bold">
              {failMessage ?? "Save failed. Please try again."}
            </span>
          )}
        </div>
      </div>
    </details>
  );
}
