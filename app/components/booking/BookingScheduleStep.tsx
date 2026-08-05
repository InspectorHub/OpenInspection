/**
 * <ScheduleStep> — the date / time-window / inspector + contact-details step of
 * the booking wizard. Split out of BookingSteps to keep each step's markup
 * readable on its own.
 */
import { useEffect, useState } from "react";
import { timeWindows } from "./booking-constants";
import { HolidayAdvisoryBanner } from "./HolidayAdvisoryBanner";
import { LanguageChoice } from "./LanguageChoice";
import { m } from "~/paraglide/messages";

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
}) {
  // Twilio/CTIA require the opt-in to be branded with the end business name.
  const company = companyName?.trim() || m.booking_schedule_company_fallback();
  const [holidayAdvisory, setHolidayAdvisory] = useState<{ date: string; name: string } | null>(null);

  useEffect(() => {
    if (!tenant || !/^\d{4}-\d{2}-\d{2}$/.test(inspectionDate)) {
      setHolidayAdvisory(null);
      return;
    }
    const params = new URLSearchParams({ tenant, date: inspectionDate });
    if (serviceIds?.length) params.set("serviceIds", serviceIds.join(","));
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/public/slots?${params.toString()}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((body) => {
          const advisory = (body as {
            data?: { holidayAdvisory?: { date: string; name: string } };
          } | null)?.data?.holidayAdvisory;
          setHolidayAdvisory(advisory ?? null);
        })
        .catch(() => setHolidayAdvisory(null));
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [tenant, inspectionDate, serviceIds]);

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
            onChange={(e) => setInspectionDate(e.target.value)}
            className="mt-1 w-full h-10 px-3 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none text-[14px] font-medium tabular-nums transition-colors"
          />
        </label>
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
              <span className="text-[11px] text-ih-fg-4">{m.booking_schedule_custom_time_suffix()}</span>
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
              className="font-semibold text-ih-primary hover:underline"
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
