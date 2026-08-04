import { Link } from "react-router";
import { Modal } from "@core/shared-ui";
import { calendarItemHref, type CalendarEvent } from "~/components/calendar/calendar-helpers";
import { formatDate, formatDateTime } from "~/lib/format";
import { m } from "~/paraglide/messages";

/**
 * A status word the viewer can read.
 *
 * The modal used to print the raw column value with its underscores swapped for
 * spaces, so a Spanish UI showed "results received". These come from the
 * message catalogue, which follows the VIEWER'S LANGUAGE — deliberately not
 * `useDisplayLocale`, which resolves the tenant's locale SETTING and is the
 * reason the calendar chrome above still says "August 2026" under a Spanish UI.
 * Language follows the viewer; only date SHAPE follows the tenant.
 */
function statusLabel(status: string): string {
  if (status === "scheduled") return m.label_status_scheduled();
  if (status === "completed") return m.label_status_completed();
  if (status === "cancelled") return m.label_status_cancelled();
  if (status === "results_received") return m.calendar_event_status_results_received();
  // Inspection lifecycle values (draft/in_progress/delivered/…) already have
  // their own labels elsewhere; until this modal is taught them, the legacy
  // rendering is better than a blank.
  return status.replace(/_/g, " ");
}

interface CalendarEventModalProps {
  event: CalendarEvent;
  open: boolean;
  displayTz: string;
  locale: string;
  onClose: () => void;
}

export function CalendarEventModal({ event, open, displayTz, locale, onClose }: CalendarEventModalProps) {
  // ONE function decides the destination, and it is allowed to answer "nowhere"
  // — a company holiday used to render an "Open inspection" button pointing at
  // `/inspections/holiday:2026-08-04`. See `calendarItemHref`.
  const href = calendarItemHref(event);
  // An ALL-DAY item is a civil day, not an instant. Converting one through the
  // viewer's zone is the calendar off-by-one in its purest form: a holiday
  // stored as `2026-08-27` was rendered as "Aug 26, 2026, 8:00 PM EDT" — the
  // wrong DAY, with a time nobody ever set. `timeZone: 'UTC'` here is
  // deliberate and is not a display choice: `formatDate` anchors a civil string
  // at UTC midnight, so formatting it back in UTC returns the day as written.
  const allDay = event.extendedProps?.allDay === true;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={event.title}
      size="sm"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="h-8 px-4 rounded-md border border-ih-border text-[13px] font-medium text-ih-fg-3"
          >
            {m.common_close()}
          </button>
          {href && (
            // A real link, not a navigate() handler: an inspector in a driveway
            // long-presses to open the job in another tab, and a <button> gives
            // them nothing to press.
            <Link
              to={href}
              onClick={onClose}
              className="h-8 px-4 rounded-md bg-ih-primary text-ih-fg-inverse font-bold text-[13px] hover:bg-ih-primary-600 inline-flex items-center"
            >
              {m.calendar_event_open_inspection()}
            </Link>
          )}
        </>
      }
    >
      <div className="space-y-2 text-[13px] text-ih-fg-3">
        <p>
          <span className="font-bold text-ih-fg-3 text-[11px] uppercase">{m.calendar_event_date_label()}</span>{" "}
          {!event.start
            ? m.calendar_event_na()
            : allDay
              ? formatDate(event.civilDate || event.start, { locale, timeZone: "UTC" })
              : formatDateTime(event.start, { locale, timeZone: displayTz })}
        </p>
        {/* The wall clock the SERVER already resolved in the viewer's effective
            zone. Never re-derived from `start` here — that is the calendar
            off-by-one, and a visit computed as "48 hours later" is exactly the
            item whose hour moves across a DST boundary. */}
        {event.startTime && (
          <p>
            <span className="font-bold text-ih-fg-3 text-[11px] uppercase">{m.calendar_event_time_label()}</span>{" "}
            {event.endTime
              ? m.calendar_event_time_range({ start: event.startTime, end: event.endTime })
              : event.startTime}
          </p>
        )}
        {event.status && (
          <p>
            <span className="font-bold text-ih-fg-3 text-[11px] uppercase">{m.calendar_event_status_label()}</span>{" "}
            {statusLabel(event.status)}
          </p>
        )}
      </div>
    </Modal>
  );
}
