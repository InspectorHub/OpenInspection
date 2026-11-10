import { m } from "~/paraglide/messages";
import type { DepositPolicy } from "../../../server/lib/billing/deposit-policy";

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
  services: { id: string; name: string; price: number; duration: number; depositPolicy?: DepositPolicy | null }[];
  /** ISO 4217 the company bills in. 'USD' when the workspace has not said. */
  currency?: string;
  /**
   * The workspace deposit default, shipped so the form can QUOTE the amount
   * before the client commits. It is a quote and never the authority — the
   * server resolves it again from the same catalogue rows at booking time and
   * freezes its own answer on the order.
   */
  depositPolicy?: DepositPolicy | null;
  /**
   * Whether the company's own Stripe account holds every key a card payment
   * needs. Absent reads as false: a Pay button is only offered on a positive
   * answer, so an older server never promises a payment it cannot take.
   */
  paymentsAvailable?: boolean;
}

/**
 * True when the up-front amount is the whole fee (the 100% preset, or a fixed
 * amount at or above the total). The deposit wording ("a deposit", "comes off
 * your total") is then untrue, so the booking copy branches on this. Compared
 * in whole cents so a $450.00 total and a 45000-cent deposit agree.
 */
export function isFullFeeDeposit(depositCents: number, totalPrice: number): boolean {
  return depositCents > 0 && depositCents >= Math.round(totalPrice * 100);
}
