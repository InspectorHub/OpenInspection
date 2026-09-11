import type { CompanyProfile } from "./booking-constants";
import { PublicAddressAutocomplete, type PublicAddressSuggestion } from "./PublicAddressAutocomplete";
import { BookingDepositPanel } from "./BookingDepositPanel";
import { BookingSummaryCard } from "./BookingSummaryCard";
import { formatCurrency } from "~/lib/format";
import { useDisplayLocale } from "~/hooks/useSessionContext";
import { m } from "~/paraglide/messages";

export function PropertyStep({
  address,
  setAddress,
  onSelectAddress,
}: {
  address: string;
  setAddress: (v: string) => void;
  /** Carries the ZIP + placeId of a picked suggestion up to the form state. */
  onSelectAddress: (sel: PublicAddressSuggestion | null) => void;
}) {
  return (
    <section className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-[18px] font-semibold tracking-tight text-ih-fg-1">{m.booking_step_property_heading()}</h2>
        <p className="text-[13px] text-ih-fg-3">{m.booking_step_property_subtitle()}</p>
      </div>
      <label className="block">
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3">{m.booking_field_address_label()}</span>
        <PublicAddressAutocomplete
          value={address}
          onValueChange={setAddress}
          onSelect={onSelectAddress}
          placeholder={m.booking_step_property_address_placeholder()}
          autoFocus
        />
      </label>
    </section>
  );
}

export function ServicesStep({
  profile,
  selectedServices,
  toggleService,
  totalPrice,
  depositQuoteCents,
  currency,
}: {
  profile: CompanyProfile;
  selectedServices: Set<string>;
  toggleService: (id: string) => void;
  totalPrice: number;
  /** Quoted, not charged. 0 renders nothing at all. */
  depositQuoteCents: number;
  currency: string;
}) {
  const locale = useDisplayLocale();
  return (
    <section className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-[18px] font-semibold tracking-tight text-ih-fg-1">{m.booking_step_services_heading()}</h2>
        <p className="text-[13px] text-ih-fg-3">{m.booking_step_services_subtitle()}</p>
      </div>
      <div className="space-y-2">
        {profile.services.map((svc) => {
          const selected = selectedServices.has(svc.id);
          return (
            <label key={svc.id} className="block cursor-pointer">
              <input
                type="checkbox"
                checked={selected}
                onChange={() => toggleService(svc.id)}
                className="sr-only"
              />
              <div className={`px-4 py-3 rounded-md border transition-all flex items-center justify-between gap-3 ${
                selected
                  ? "border-ih-primary bg-ih-primary-tint ring-2 ring-ih-primary/10"
                  : "border-ih-border bg-ih-bg-card hover:border-ih-border-strong"
              }`}>
                <div className="min-w-0">
                  <div className="text-[13px] font-bold text-ih-fg-1 truncate">{svc.name}</div>
                  <div className="text-[11px] text-ih-fg-3 mt-0.5">
                    {m.booking_step_services_duration({ duration: svc.duration })}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-sm font-semibold text-ih-fg-1">${(svc.price / 100).toFixed(2)}</span>
                  {selected && (
                    <svg className="w-4 h-4 text-ih-primary-text" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </div>
              </div>
            </label>
          );
        })}
      </div>
      {selectedServices.size > 0 && (
        <div className="px-4 py-2 rounded-md bg-ih-bg-muted flex items-center justify-between">
          <span className="text-[12px] font-bold text-ih-fg-3">
            {selectedServices.size} {selectedServices.size === 1 ? m.booking_unit_inspection_one() : m.booking_unit_inspection_other()}
          </span>
          <span className="text-[15px] font-bold text-ih-fg-1 tabular-nums">
            ${totalPrice.toFixed(2)}
          </span>
        </div>
      )}
      {selectedServices.size > 0 && depositQuoteCents > 0 && (
        <p className="px-4 text-[12px] text-ih-fg-3 leading-relaxed">
          {m.booking_deposit_quote_note({
            amount: formatCurrency(depositQuoteCents, { locale, currency }),
          })}
        </p>
      )}
    </section>
  );
}


export function ConfirmStep({
  message,
  address,
  inspectionDate,
  timeWindow,
  customTime,
  selectedServices,
  selectedServiceNames = [],
  showInspectorDropdown,
  chosenInspectorName,
  totalPrice,
  clientName,
  clientEmail,
  depositQuoteCents,
  depositDueCents,
  bookedInspectionId,
  currency,
  companyName,
}: {
  message: { text: string; ok: boolean } | null;
  address: string;
  inspectionDate: string;
  timeWindow: string;
  customTime: string;
  selectedServices: Set<string>;
  /** F44 — the names behind the total. Empty falls back to the count. */
  selectedServiceNames?: string[];
  showInspectorDropdown: boolean;
  chosenInspectorName: string;
  totalPrice: number;
  clientName: string;
  clientEmail: string;
  /** What the form expects to be asked for, before submitting. */
  depositQuoteCents: number;
  /** What the SERVER froze, once the booking exists. Null before then. */
  depositDueCents: number | null;
  bookedInspectionId: string | null;
  currency: string;
  companyName: string;
}) {
  const locale = useDisplayLocale();
  const summary = (
    <BookingSummaryCard
      address={address}
      inspectionDate={inspectionDate}
      timeWindow={timeWindow}
      customTime={customTime}
      serviceCount={selectedServices.size}
      serviceNames={selectedServiceNames}
      showInspector={showInspectorDropdown}
      chosenInspectorName={chosenInspectorName}
      totalPrice={totalPrice}
      depositQuoteCents={depositQuoteCents}
      clientName={clientName}
      clientEmail={clientEmail}
      currency={currency}
      locale={locale}
    />
  );
  return (
    <section className="space-y-5">
      {message?.ok ? (
        <div className="py-8 space-y-5">
          <div className="text-center">
            <div className="w-16 h-16 rounded-full bg-ih-ok-bg flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-ih-ok-fg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-ih-fg-1 mb-2">{m.booking_confirm_submitted_heading()}</h2>
            <p className="text-[14px] text-ih-fg-3">{message.text}</p>
          </div>
          {/* F44 — the confirmation used to be a tick and a sentence. The client
              leaves this page with a date in their calendar and a deposit on
              their card; it has to say which appointment that was. Same rows as
              the review step, from the same values, so the two cannot disagree. */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3 mb-2">
              {m.booking_confirm_whats_booked_heading()}
            </p>
            {summary}
          </div>
          {/* Only once the server has said what it froze, and only if it froze
              anything. A workspace with no deposit sees no payment step. */}
          {bookedInspectionId && depositDueCents != null && depositDueCents > 0 && (
            <BookingDepositPanel
              inspectionId={bookedInspectionId}
              depositCents={depositDueCents}
              currency={currency}
              companyName={companyName}
            />
          )}
        </div>
      ) : (
        <>
          <div className="space-y-1">
            <h2 className="text-[18px] font-semibold tracking-tight text-ih-fg-1">{m.booking_confirm_details_heading()}</h2>
            <p className="text-[13px] text-ih-fg-3">{m.booking_confirm_subtitle()}</p>
          </div>
          {summary}
          {depositQuoteCents > 0 && (
            <p className="text-[12px] text-ih-fg-3 leading-relaxed">
              {m.booking_deposit_confirm_note({
                amount: formatCurrency(depositQuoteCents, { locale, currency }),
              })}
            </p>
          )}
        </>
      )}
    </section>
  );
}

// ScheduleStep lives in its own module (file-size ratchet); re-exported so
// callers keep one import site for the wizard steps.
export { ScheduleStep } from "./BookingScheduleStep";
