import type { BookingSlotIntervalMin } from "~/components/settings/BookingSlotRulesPanel";
import type { HolidayInternalPolicy, HolidayPublicPolicy } from "~/components/settings/HolidayClosedPanel";

/** Tolerant readers for the booking settings the typed client returns as `unknown`. */

export function parseSlotInterval(raw: unknown): BookingSlotIntervalMin {
  return raw === 15 || raw === 60 ? raw : 30;
}

export function parsePublicPolicy(raw: unknown): HolidayPublicPolicy {
  return raw === "block" || raw === "advisory" || raw === "open" ? raw : "open";
}

export function parseInternalPolicy(raw: unknown): HolidayInternalPolicy {
  return raw === "block" ? "block" : "advisory";
}
