import { Select } from "@core/shared-ui";
import { SUPPORTED_STATE_CODES, regionOptionLabel } from "./holiday-region-options";
import { m } from "~/paraglide/messages";

/**
 * What happens on a day the holiday catalog marks closed. Only meaningful
 * once a region is selected — with no catalog there are no holidays to have
 * a policy about.
 */
export type HolidayPolicyId = "closed" | "on-request";

/**
 * The region is the catalog's master switch: `null` means the resolver returns
 * no closed dates at all. Off is therefore an option on this control, not a
 * policy sitting alongside the two real ones.
 */
export function HolidayRegionSwitch({
  region,
  saving,
  onChange,
}: {
  region: string | null;
  saving: boolean;
  onChange: (region: string | null) => void;
}) {
  const options = [
    { value: "", label: m.settings_holiday_catalog_off() },
    { value: "US", label: m.settings_holiday_region_federal_only() },
    ...SUPPORTED_STATE_CODES.map((code) => ({
      value: `US-${code}`,
      label: regionOptionLabel(code),
    })),
  ];
  return (
    <div className="max-w-sm space-y-1" data-testid="holiday-region-switch">
      <Select
        label={m.settings_holiday_catalog_label()}
        options={options}
        value={region ?? ""}
        disabled={saving}
        onChange={(e) => onChange(e.target.value || null)}
      />
      {!region && (
        <p className="text-[12px] text-ih-fg-3">{m.settings_holiday_catalog_off_help()}</p>
      )}
    </div>
  );
}

export function HolidayPolicyCards({
  activePolicy,
  saving,
  onSelect,
}: {
  activePolicy: HolidayPolicyId | null;
  saving: boolean;
  onSelect: (policy: HolidayPolicyId) => void;
}) {
  const POLICIES = [
    {
      id: "closed" as const,
      title: m.settings_holiday_policy_closed_title(),
      detail: m.settings_holiday_policy_closed_detail(),
    },
    {
      id: "on-request" as const,
      title: m.settings_holiday_policy_request_title(),
      detail: m.settings_holiday_policy_request_detail(),
    },
  ] as const;
  return (
    <div className="space-y-2">
      <p className="text-[12px] font-bold text-ih-fg-2">{m.settings_holiday_policy_heading()}</p>
      <div
        data-testid="holiday-policy-row"
        role="radiogroup"
        aria-label={m.settings_holiday_policy_aria()}
        className="grid grid-cols-1 sm:grid-cols-2 gap-3"
      >
        {POLICIES.map((policy) => {
          const selected = activePolicy === policy.id;
          return (
            <button
              key={policy.id}
              type="button"
              role="radio"
              aria-checked={selected}
              data-testid={`holiday-policy-${policy.id}`}
              onClick={() => onSelect(policy.id)}
              disabled={saving}
              className={`text-left rounded-md border px-3 py-3 transition-colors ${
                selected
                  ? "border-ih-primary bg-ih-primary-tint ring-2 ring-ih-primary/10"
                  : "border-ih-border bg-ih-bg-card hover:bg-ih-bg-muted"
              }`}
            >
              <div className="text-[13px] font-bold text-ih-fg-1">{policy.title}</div>
              <div className="text-[11px] text-ih-fg-3 mt-1">{policy.detail}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
