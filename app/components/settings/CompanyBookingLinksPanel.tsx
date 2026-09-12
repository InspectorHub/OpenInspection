import { useCopyClipboard } from "~/hooks/useCopyClipboard";
import { BookingClosedNotice, type BookingOpenState } from "~/components/settings/BookingClosedNotice";
import { m } from "~/paraglide/messages";

const NO_BOOKING_STATE: BookingOpenState = { open: null, reason: null };

export function CompanyBookingLinksPanel({
  tenant,
  booking = NO_BOOKING_STATE,
}: {
  tenant: string | null | undefined;
  /**
   * Whether the page this address points at is OPEN, as the booking profile
   * derived it (`app/lib/settings/booking-open.server`). Defaults to "not
   * known", which renders no claim either way.
   */
  booking?: BookingOpenState;
}) {
  const { copied: copiedField, copy } = useCopyClipboard();
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const companyUrl = tenant ? `${origin}/book/${tenant}` : null;

  if (!companyUrl) return null;

  return (
    <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-4">
      <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">{m.settings_companylink_heading()}</h3>
      {/* F36 — the closed state is stated ABOVE the address and the Copy button,
          because this is the section the page lands on and the one that used to
          invite sharing a dead end. Renders nothing when booking is open. */}
      <BookingClosedNotice state={booking} />
      <div className="flex items-center gap-3">
        <span className="text-[12px] font-bold text-ih-fg-2 w-36 shrink-0">{m.settings_companylink_booking_page()}</span>
        <span className="text-[12px] text-ih-fg-1 truncate flex-1 font-mono bg-ih-bg-muted rounded px-2 py-1.5 border border-ih-border">
          {companyUrl}
        </span>
        <button
          type="button"
          onClick={() => copy(companyUrl, "company")}
          className="h-8 px-3 rounded-md bg-ih-primary text-ih-fg-inverse font-bold text-[12px] hover:bg-ih-primary-600 transition-colors shrink-0"
        >
          {copiedField === "company" ? m.settings_common_copied() : m.common_copy()}
        </button>
        <a
          href={companyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-ih-fg-3 hover:text-ih-primary-text transition-colors shrink-0"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"
            />
          </svg>
        </a>
      </div>
      {/* F36 — WHY Copy stays enabled while booking is closed, and the copy
          changes instead. The address is permanent and correct: an operator
          pasting it into a website draft, an email signature or a print job is
          doing legitimate work, and disabling the button would block that while
          still explaining nothing. What was wrong was the sentence — "Share the
          company link" next to an address that answers "Online booking isn't
          open yet". So the instruction is replaced by the consequence: the
          operator still gets the link, and learns what a client who opens it
          today actually sees. */}
      <p className="text-[12px] text-ih-fg-3">
        {booking.open === false
          ? m.settings_companylink_share_hint_closed({ headline: m.booking_not_open_heading() })
          : m.settings_companylink_share_hint()}
      </p>
    </section>
  );
}
