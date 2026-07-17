import { m } from "~/paraglide/messages";

// Functions (not module consts) so the labels resolve in the active locale at
// call time, never frozen at import. The `id`s are the API timeSlot enum and
// stay literal.
export function stepLabels(): string[] {
  return [
    m.helper_booking_step_property(),
    m.helper_booking_step_services(),
    m.helper_booking_step_schedule(),
    m.helper_booking_step_confirm(),
  ];
}

export function timeWindows(): { id: string; label: string; detail: string }[] {
  return [
    { id: "morning", label: m.helper_booking_window_morning_label(), detail: m.helper_booking_window_morning_detail() },
    { id: "afternoon", label: m.helper_booking_window_afternoon_label(), detail: m.helper_booking_window_afternoon_detail() },
    // id must match the API timeSlot enum ('all-day', not 'allday')
    { id: "all-day", label: m.helper_booking_window_allday_label(), detail: m.helper_booking_window_allday_detail() },
    { id: "custom", label: m.helper_booking_window_custom_label(), detail: m.helper_booking_window_custom_detail() },
  ];
}

export interface CompanyProfile {
  company: string;
  turnstileSiteKey?: string | null;
  bookingOpen?: boolean;
  allowInspectorChoice?: boolean;
  conciergeReviewRequired?: boolean;
  inspectors: { id: string; name: string | null; photoUrl: string | null }[];
  services: { id: string; name: string; price: number; duration: number }[];
}
