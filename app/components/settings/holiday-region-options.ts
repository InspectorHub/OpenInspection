import { m } from "~/paraglide/messages";

/** State codes bundled in the holiday catalog (federal + state). */
export const SUPPORTED_STATE_CODES = ["TX", "CA", "NY", "FL", "IL"] as const;

export type SupportedStateCode = (typeof SUPPORTED_STATE_CODES)[number];

/**
 * State names are per-code messages rather than one interpolated string:
 * a place name is translated, not formatted ("New York" is "Nueva York" in
 * es-419), so each needs its own catalog entry for translators to reach.
 */
const STATE_NAME: Record<SupportedStateCode, () => string> = {
  TX: () => m.settings_holiday_state_tx(),
  CA: () => m.settings_holiday_state_ca(),
  NY: () => m.settings_holiday_state_ny(),
  FL: () => m.settings_holiday_state_fl(),
  IL: () => m.settings_holiday_state_il(),
};

export function stateName(code: SupportedStateCode): string {
  return STATE_NAME[code]();
}

/** e.g. "Federal + Texas (TX)" — the name to read, the code to cross-check. */
export function regionOptionLabel(code: SupportedStateCode): string {
  return m.settings_holiday_region_federal_plus({ name: stateName(code), code });
}
