/**
 * <BookingSummaryCard> — what was asked for, in one card.
 *
 * Extracted from `ConfirmStep` because F44 needed it in TWO places and a second
 * copy would have drifted: the review-before-submitting step showed these rows,
 * and the page the client lands on AFTER submitting showed a green tick, a
 * sentence, and nothing about the appointment at all. A confirmation that does
 * not state what was confirmed leaves the client with a charge, a date they
 * half-remember typing, and no record until the email arrives.
 *
 * Rows only. The deposit note, the payment panel and the headings stay with the
 * step, which is the thing that differs between the two moments.
 */
import { timeWindows } from "./booking-constants";
import { formatBookingDate } from "./booking-date-rules";
import { formatCurrency } from "~/lib/format";
import { m } from "~/paraglide/messages";

export function BookingSummaryCard({
  address,
  inspectionDate,
  timeWindow,
  customTime,
  serviceCount,
  serviceNames,
  showInspector,
  chosenInspectorName,
  totalPrice,
  depositQuoteCents,
  clientName,
  clientEmail,
  currency,
  locale,
}: {
  address: string;
  inspectionDate: string;
  timeWindow: string;
  customTime: string;
  serviceCount: number;
  /** F44 — the names behind the total. Empty falls back to the count. */
  serviceNames: string[];
  showInspector: boolean;
  chosenInspectorName: string;
  totalPrice: number;
  depositQuoteCents: number;
  clientName: string;
  clientEmail: string;
  currency: string;
  locale: string;
}) {
  return (
    <div className="bg-ih-bg-muted rounded-md p-4 space-y-3 text-[13px] text-left">
      <div className="flex justify-between gap-4">
        <span className="text-ih-fg-3">{m.booking_confirm_row_address()}</span>
        <span className="font-medium text-ih-fg-1 text-right">{address}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-ih-fg-3">{m.booking_confirm_row_date()}</span>
        {/* F44 — this row read `2020-01-05`. A bare ISO date is the one rendering
            in which a Sunday six years ago is indistinguishable from next
            Wednesday, and this is the last screen before the client commits.
            The weekday is the point. */}
        <span className="font-medium text-ih-fg-1 text-right">
          {formatBookingDate(inspectionDate, locale)}
        </span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-ih-fg-3">{m.booking_confirm_row_time()}</span>
        <span className="font-medium text-ih-fg-1 text-right">
          {timeWindow === "custom" ? customTime : timeWindows().find((w) => w.id === timeWindow)?.label}
        </span>
      </div>
      {/* F44 — `Services  1 selected` sat one line above `Total $450.00`, so the
          figure the client was agreeing to named nothing. The count survives only
          as the fallback for a catalogue that did not load: a count is a fact
          about the form, not about the purchase. */}
      <div className="flex justify-between gap-4">
        <span className="text-ih-fg-3">{m.booking_confirm_row_services()}</span>
        <span className="font-medium text-ih-fg-1 text-right">
          {serviceNames.length > 0
            ? serviceNames.map((name) => <span key={name} className="block">{name}</span>)
            : m.booking_confirm_services_selected({ count: serviceCount })}
        </span>
      </div>
      {showInspector && (
        <div className="flex justify-between gap-4">
          <span className="text-ih-fg-3">{m.booking_field_inspector_label()}</span>
          <span className="font-medium text-ih-fg-1 text-right">{chosenInspectorName}</span>
        </div>
      )}
      <div className="flex justify-between gap-4 border-t border-ih-border pt-3">
        <span className="font-bold text-ih-fg-2">{m.booking_confirm_row_total()}</span>
        <span className="font-bold text-ih-fg-1 tabular-nums">${totalPrice.toFixed(2)}</span>
      </div>
      {depositQuoteCents > 0 && (
        <div className="flex justify-between gap-4">
          <span className="text-ih-fg-3">{m.booking_confirm_row_deposit()}</span>
          <span className="font-medium text-ih-fg-1 tabular-nums">
            {formatCurrency(depositQuoteCents, { locale, currency })}
          </span>
        </div>
      )}
      <div className="flex justify-between gap-4">
        <span className="text-ih-fg-3">{m.booking_confirm_row_name()}</span>
        <span className="font-medium text-ih-fg-1 text-right">{clientName}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-ih-fg-3">{m.booking_field_email_label()}</span>
        <span className="font-medium text-ih-fg-1 text-right break-all">{clientEmail}</span>
      </div>
    </div>
  );
}
