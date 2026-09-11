import { Link } from "react-router";
import { Banner } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

/**
 * F36 — `/settings/booking` says, before it offers anything to share, that the
 * page being configured is CLOSED, and names the one thing blocking it.
 *
 * The page used to open on "Company link": a public booking address, a Copy
 * button, and "Share the company link" — for an address that rendered "Online
 * booking isn't open yet". The truth was on the page, seven sections down, in
 * the embed tab's live preview, below the fold.
 *
 * Booking-open is DERIVED, not a switch, and it is derived in exactly one place
 * (`server/api/bookings/profile.ts`: a qualified inspector has hours AND the
 * company declared a time zone). This component renders what that derivation
 * said; it never re-decides it. There is deliberately no toggle here.
 */

export type BookingClosedReason = "no_inspector_hours" | "no_company_timezone";

export interface BookingOpenState {
  /**
   * `true` / `false` as the booking profile derived it; `null` when the read
   * failed. Null renders NOTHING: a notice this page cannot justify is as
   * dishonest as the silence it replaces, and "open" must never be guessed
   * either.
   */
  open: boolean | null;
  reason: BookingClosedReason | null;
}

export function BookingClosedNotice({ state }: { state: BookingOpenState }) {
  if (state.open !== false) return null;

  // Quote the visitor-facing headline from the message the public page renders,
  // rather than retyping it here — two copies of one sentence drift, and the
  // one that drifts is the one nobody sees.
  const headline = m.booking_not_open_heading();

  const fix =
    state.reason === "no_company_timezone"
      ? { to: "/settings/workspace", label: m.settings_bookingclosed_fix_timezone() }
      : state.reason === "no_inspector_hours"
        ? { to: "/settings/schedule", label: m.settings_bookingclosed_fix_hours() }
        : null;

  const body =
    state.reason === "no_company_timezone"
      ? m.settings_bookingclosed_no_timezone({ headline })
      : state.reason === "no_inspector_hours"
        ? m.settings_bookingclosed_no_hours({ headline })
        // A closed page whose reason the API did not name (an older deployment,
        // say) still says it is closed, and names both requirements.
        : m.settings_bookingclosed_unknown({ headline });

  return (
    <Banner
      tone="warn"
      actions={
        fix ? (
          <Link to={fix.to} className="text-sm font-bold text-ih-primary-text hover:underline">
            {fix.label}
          </Link>
        ) : undefined
      }
    >
      {body}
    </Banner>
  );
}
