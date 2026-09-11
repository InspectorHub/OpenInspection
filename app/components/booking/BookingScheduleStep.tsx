/**
 * <ScheduleStep> — the date / time-window / inspector + contact-details step of
 * the booking wizard. Split out of BookingSteps to keep each step's markup
 * readable on its own.
 */
import { useEffect, useMemo, useState } from "react";
import { timeWindows } from "./booking-constants";
import { HolidayAdvisoryBanner } from "./HolidayAdvisoryBanner";
import { LanguageChoice } from "./LanguageChoice";
import {
  BOOKING_HORIZON_DAYS,
  addDaysCivil,
  formatBookingDate,
  todayCivil,
  type BookingDateIssue,
} from "./booking-date-rules";
import { useDisplayLocale } from "~/hooks/useSessionContext";
import { m } from "~/paraglide/messages";

/** The one message each refusal gets. Kept beside the enum it switches on. */
function dateIssueMessage(issue: BookingDateIssue): string {
  switch (issue) {
    case "past": return m.booking_date_error_past();
    case "too-far": return m.booking_date_error_too_far();
    case "invalid": return m.booking_date_error_invalid();
  }
}

export function ScheduleStep({
  inspectionDate,
  setInspectionDate,
  timeWindow,
  setTimeWindow,
  customTime,
  setCustomTime,
  showInspectorDropdown,
  chosenInspectorId,
  setChosenInspectorId,
  inspectorOptions,
  clientName,
  setClientName,
  clientEmail,
  setClientEmail,
  smsOptin,
  setSmsOptin,
  locale,
  setLocale,
  privacyUrl,
  termsUrl,
  companyName,
  tenant,
  serviceIds,
  conciergeReviewRequired = false,
  contactIsSelf = true,
  prefilledFromDevice = false,
  onClearRememberedContact,
  dateIssue = null,
  onDateBookableChange,
}: {
  inspectionDate: string;
  setInspectionDate: (v: string) => void;
  timeWindow: string;
  setTimeWindow: (v: string) => void;
  customTime: string;
  setCustomTime: (v: string) => void;
  showInspectorDropdown: boolean;
  chosenInspectorId: string | null;
  setChosenInspectorId: (v: string | null) => void;
  inspectorOptions: { id: string; name: string | null; photoUrl: string | null }[];
  clientName: string;
  setClientName: (v: string) => void;
  clientEmail: string;
  setClientEmail: (v: string) => void;
  smsOptin: boolean;
  setSmsOptin: (v: boolean) => void;
  /** The client's stated language, or null when they have not said. */
  locale: string | null;
  setLocale: (v: string) => void;
  privacyUrl: string | null;
  termsUrl: string | null;
  companyName: string;
  tenant?: string;
  serviceIds?: string[];
  conciergeReviewRequired?: boolean;
  /** False when the fields hold someone else's client (an agent booking). */
  contactIsSelf?: boolean;
  prefilledFromDevice?: boolean;
  onClearRememberedContact?: () => void;
  /** Why the chosen date cannot be submitted, decided in `booking-date-rules`. */
  dateIssue?: BookingDateIssue | null;
  /**
   * F42 — raised when the company offers nothing at all on the chosen date.
   * The step learns this from the slots endpoint; Continue is held by the form
   * state, which is the only place that can hold it.
   */
  onDateBookableChange?: (unbookable: boolean) => void;
}) {
  // Twilio/CTIA require the opt-in to be branded with the end business name.
  const company = companyName?.trim() || m.booking_schedule_company_fallback();
  const displayLocale = useDisplayLocale();
  const [holidayAdvisory, setHolidayAdvisory] = useState<{ date: string; name: string } | null>(null);
  // Null while unknown (not yet asked, still in flight, or the request failed):
  // an unreachable endpoint must not accuse the visitor of picking a bad date.
  const [dateHasSlots, setDateHasSlots] = useState<boolean | null>(null);
  // The picker's own floor and ceiling. Computed once per mount — a visitor who
  // leaves the tab open across midnight is re-checked by the form state and the
  // server anyway, and a value that changes under a focused field is worse.
  const today = useMemo(() => todayCivil(), []);
  const lastBookableDate = useMemo(() => addDaysCivil(today, BOOKING_HORIZON_DAYS), [today]);
  /**
   * The services, as a value rather than an identity.
   *
   * `serviceIds` arrives as a fresh array on every parent render, so depending
   * on it directly re-ran the lookup on renders that changed nothing — and since
   * the lookup clears its own answer first, the availability message appeared and
   * vanished in a loop the moment reporting it upward caused a re-render.
   */
  const serviceKey = (serviceIds ?? []).join(",");

  useEffect(() => {
    if (!tenant || !/^\d{4}-\d{2}-\d{2}$/.test(inspectionDate)) {
      setHolidayAdvisory(null);
      setDateHasSlots(null);
      return;
    }
    // A date the rules already refused is not worth an availability question —
    // and asking would let a stale "no times available" message sit under a
    // field whose real problem is that the date has passed.
    if (dateIssue) {
      setHolidayAdvisory(null);
      setDateHasSlots(null);
      return;
    }
    setDateHasSlots(null);
    const params = new URLSearchParams({ tenant, date: inspectionDate });
    if (serviceKey) params.set("serviceIds", serviceKey);
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/public/slots?${params.toString()}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((body) => {
          const data = (body as {
            data?: {
              holidayAdvisory?: { date: string; name: string };
              slots?: { time: string; available: boolean }[];
            };
          } | null)?.data;
          setHolidayAdvisory(data?.holidayAdvisory ?? null);
          // The tenant's weekly hours, slot rules, time off, holidays and
          // calendar blocks all land in this one array. No slot is bookable =>
          // the company is not working that day, whatever the grid looks like.
          setDateHasSlots(
            Array.isArray(data?.slots) ? data.slots.some((s) => s.available) : null,
          );
        })
        .catch(() => {
          setHolidayAdvisory(null);
          setDateHasSlots(null);
        });
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [tenant, inspectionDate, serviceKey, dateIssue]);

  // Report upward, never decide upward: `false` is a measured answer, `null` is
  // "we do not know", and only the first one may stop a booking.
  useEffect(() => {
    onDateBookableChange?.(dateHasSlots === false);
    // The callback identity changes on every parent render; depending on it
    // would re-fire this on unrelated renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateHasSlots]);

  return (
    <section className="space-y-8">
      <div className="space-y-5">
        <div className="space-y-1">
          <h2 className="text-[18px] font-semibold tracking-tight text-ih-fg-1">{m.booking_step_schedule_heading()}</h2>
          <p className="text-[13px] text-ih-fg-3">{m.booking_step_schedule_subtitle()}</p>
        </div>
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3">{m.booking_field_inspection_date_label()}</span>
          <input
            type="date"
            value={inspectionDate}
            // F42 — the picker itself refuses the past and the far future, so
            // the commonest two mistakes are not made rather than reported. It
            // is the courtesy layer only: the form state re-checks the value
            // (a typed date bypasses `min` in several browsers) and the server
            // decides again in the company's own timezone.
            min={today}
            max={lastBookableDate}
            aria-invalid={dateIssue ? true : undefined}
            aria-describedby={dateIssue ? "booking-date-problem" : undefined}
            onChange={(e) => setInspectionDate(e.target.value)}
            className="mt-1 w-full h-10 px-3 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none text-[14px] font-medium tabular-nums transition-colors"
          />
          {/* The native control renders its own placeholder and parts in the
              BROWSER's language, not the page's: measured on an English page
              with its own English/Spanish selector, the field's placeholder came
              out in the browser UI language instead (F44). This echo is the one
              reading that is in the page's language — and with the weekday on it
              a Sunday announces itself here rather than at the confirm step. */}
          {!dateIssue && /^\d{4}-\d{2}-\d{2}$/.test(inspectionDate) && (
            <span className="mt-1 block text-[12px] text-ih-fg-3">
              {formatBookingDate(inspectionDate, displayLocale)}
            </span>
          )}
        </label>
        {dateIssue && (
          <p
            id="booking-date-problem"
            role="alert"
            className="text-[12px] font-semibold text-ih-bad-fg"
          >
            {dateIssueMessage(dateIssue)}
          </p>
        )}
        {/* Not an error the visitor made — the company simply is not working
            that day. Said here, under the field it is about, instead of as a
            409 about the TIME after four more steps of form filling. */}
        {!dateIssue && dateHasSlots === false && (
          <p role="alert" className="text-[12px] font-semibold text-ih-bad-fg">
            {m.booking_date_none_available({
              company,
              date: formatBookingDate(inspectionDate, displayLocale),
            })}
          </p>
        )}
        {holidayAdvisory && (
          <HolidayAdvisoryBanner
            name={holidayAdvisory.name}
            conciergeReviewRequired={conciergeReviewRequired}
          />
        )}
        <div>
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3">{m.booking_field_time_window_label()}</span>
          <div className="grid grid-cols-2 gap-2 mt-1">
            {timeWindows().map((w) => (
              <label key={w.id} className="cursor-pointer">
                <input type="radio" name="timeSlot" value={w.id} checked={timeWindow === w.id} onChange={() => setTimeWindow(w.id)} className="sr-only" />
                <div className={`px-3 py-2.5 rounded-md border transition-all ${
                  timeWindow === w.id
                    ? "border-ih-primary bg-ih-primary-tint ring-2 ring-ih-primary/10"
                    : "border-ih-border bg-ih-bg-card"
                }`}>
                  <div className="text-[13px] font-bold text-ih-fg-1">{w.label}</div>
                  <div className="text-[11px] text-ih-fg-3 mt-0.5">{w.detail}</div>
                </div>
              </label>
            ))}
          </div>
          {timeWindow === "custom" && (
            <div className="mt-3 flex items-center gap-2">
              <input
                type="time"
                value={customTime}
                onChange={(e) => setCustomTime(e.target.value)}
                className="h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none text-[13px] font-medium tabular-nums"
              />
              <span className="text-[11px] text-ih-fg-3">{m.booking_schedule_custom_time_suffix()}</span>
            </div>
          )}
        </div>
        {showInspectorDropdown && (
          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3">{m.booking_field_inspector_label()}</span>
            <select
              value={chosenInspectorId ?? ""}
              onChange={(e) => setChosenInspectorId(e.target.value || null)}
              className="mt-1 w-full h-10 px-3 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none text-[14px] font-medium transition-colors"
            >
              <option value="">{m.booking_schedule_inspector_no_preference()}</option>
              {inspectorOptions.map((i) => (
                <option key={i.id} value={i.id}>{i.name ?? m.booking_inspector_default_name()}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="space-y-5">
        <div className="space-y-1">
          <h2 className="text-[18px] font-semibold tracking-tight text-ih-fg-1">{m.booking_step_yourinfo_heading()}</h2>
          <p className="text-[13px] text-ih-fg-3">{m.booking_step_yourinfo_subtitle()}</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3">{m.booking_field_fullname_label()}</span>
            <input
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder={m.booking_placeholder_name()}
              autoComplete={contactIsSelf ? "name" : "off"}
              className="mt-1 w-full h-10 px-3 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none text-[14px] font-medium transition-colors"
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3">{m.booking_field_email_label()}</span>
            <input
              type="email"
              value={clientEmail}
              onChange={(e) => setClientEmail(e.target.value)}
              placeholder={m.booking_placeholder_email()}
              autoComplete={contactIsSelf ? "email" : "off"}
              className="mt-1 w-full h-10 px-3 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none text-[14px] font-medium transition-colors"
            />
          </label>
        </div>
        {prefilledFromDevice && (
          <p className="text-[12px] text-ih-fg-3">
            {m.booking_prefill_remembered_notice()}{" "}
            <button
              type="button"
              onClick={onClearRememberedContact}
              className="font-semibold text-ih-primary-text hover:underline"
            >
              {m.booking_prefill_clear()}
            </button>
          </p>
        )}
        {/* Asked only when the fields hold the visitor's OWN details. An agent
            booking for someone else would be guessing at their client's
            language, and a guess recorded as a stated preference is worse than
            no answer: it is the one number this field exists to measure. */}
        {contactIsSelf && <LanguageChoice value={locale} onChange={setLocale} />}
        {/* Track L (D6, path A) — unchecked SMS opt-in (TCPA consent). */}
        <label className="flex items-start gap-3 mt-4 cursor-pointer">
          <input
            type="checkbox"
            checked={smsOptin}
            onChange={(e) => setSmsOptin(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-ih-border text-ih-primary focus:ring-ih-primary"
          />
          <span className="text-[13px] text-ih-fg-3 leading-relaxed">
            {m.booking_schedule_sms_optin({ company })}
            {(privacyUrl || termsUrl) && (
              <>
                {" "}
                {privacyUrl && (
                  <a href={privacyUrl} target="_blank" rel="noreferrer" className="underline">{m.booking_link_privacy_policy()}</a>
                )}
                {privacyUrl && termsUrl && <span> · </span>}
                {termsUrl && (
                  <a href={termsUrl} target="_blank" rel="noreferrer" className="underline">{m.booking_link_terms()}</a>
                )}
                .
              </>
            )}
          </span>
        </label>
      </div>
    </section>
  );
}
