import { TIME_WINDOWS, type CompanyProfile } from "./booking-constants";

export function PropertyStep({
  address,
  setAddress,
}: {
  address: string;
  setAddress: (v: string) => void;
}) {
  return (
    <section className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-[18px] font-semibold tracking-tight text-ih-fg-1">Property</h2>
        <p className="text-[13px] text-ih-fg-3">Where is the inspection?</p>
      </div>
      <label className="block">
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3">Property address</span>
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="123 Main St, City, State ZIP"
          autoFocus
          className="mt-1 w-full h-10 px-3 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none text-[14px] font-medium transition-colors"
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
}: {
  profile: CompanyProfile;
  selectedServices: Set<string>;
  toggleService: (id: string) => void;
  totalPrice: number;
}) {
  return (
    <section className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-[18px] font-semibold tracking-tight text-ih-fg-1">Services</h2>
        <p className="text-[13px] text-ih-fg-3">Choose one or more inspections for this visit.</p>
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
                    ~{svc.duration} min
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-sm font-semibold text-ih-fg-1">${(svc.price / 100).toFixed(2)}</span>
                  {selected && (
                    <svg className="w-4 h-4 text-ih-primary" fill="currentColor" viewBox="0 0 20 20">
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
            {selectedServices.size} {selectedServices.size === 1 ? "inspection" : "inspections"}
          </span>
          <span className="text-[15px] font-bold text-ih-fg-1 tabular-nums">
            ${totalPrice.toFixed(2)}
          </span>
        </div>
      )}
    </section>
  );
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
  privacyUrl,
  termsUrl,
  companyName,
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
  privacyUrl: string | null;
  termsUrl: string | null;
  companyName: string;
}) {
  // Twilio/CTIA require the opt-in to be branded with the end business name.
  const company = companyName?.trim() || "your inspection company";
  return (
    <section className="space-y-8">
      <div className="space-y-5">
        <div className="space-y-1">
          <h2 className="text-[18px] font-semibold tracking-tight text-ih-fg-1">Schedule</h2>
          <p className="text-[13px] text-ih-fg-3">Pick a date and time window that works.</p>
        </div>
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3">Inspection date</span>
          <input
            type="date"
            value={inspectionDate}
            onChange={(e) => setInspectionDate(e.target.value)}
            className="mt-1 w-full h-10 px-3 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none text-[14px] font-medium tabular-nums transition-colors"
          />
        </label>
        <div>
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3">Time window</span>
          <div className="grid grid-cols-2 gap-2 mt-1">
            {TIME_WINDOWS.map((w) => (
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
              <span className="text-[11px] text-ih-fg-4">on selected date</span>
            </div>
          )}
        </div>
        {showInspectorDropdown && (
          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3">Inspector</span>
            <select
              value={chosenInspectorId ?? ""}
              onChange={(e) => setChosenInspectorId(e.target.value || null)}
              className="mt-1 w-full h-10 px-3 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none text-[14px] font-medium transition-colors"
            >
              <option value="">No preference — first available</option>
              {inspectorOptions.map((i) => (
                <option key={i.id} value={i.id}>{i.name ?? "Inspector"}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="space-y-5">
        <div className="space-y-1">
          <h2 className="text-[18px] font-semibold tracking-tight text-ih-fg-1">Your info</h2>
          <p className="text-[13px] text-ih-fg-3">How do we reach you with the report?</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3">Full name</span>
            <input
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="Jane Doe"
              className="mt-1 w-full h-10 px-3 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none text-[14px] font-medium transition-colors"
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3">Email</span>
            <input
              type="email"
              value={clientEmail}
              onChange={(e) => setClientEmail(e.target.value)}
              placeholder="jane@example.com"
              className="mt-1 w-full h-10 px-3 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none text-[14px] font-medium transition-colors"
            />
          </label>
        </div>
        {/* Track L (D6, path A) — unchecked SMS opt-in (TCPA consent). */}
        <label className="flex items-start gap-3 mt-4 cursor-pointer">
          <input
            type="checkbox"
            checked={smsOptin}
            onChange={(e) => setSmsOptin(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-ih-border text-ih-primary focus:ring-ih-primary"
          />
          <span className="text-[13px] text-ih-fg-3 leading-relaxed">
            Text me appointment &amp; report updates from {company}. By checking this box you
            agree to receive automated text messages from {company} about your inspection.
            Message frequency varies by your inspection activity. Message &amp; data rates may
            apply; reply STOP to opt out, HELP for help. Consent is not a condition of booking.
            {(privacyUrl || termsUrl) && (
              <>
                {" "}
                {privacyUrl && (
                  <a href={privacyUrl} target="_blank" rel="noreferrer" className="underline">Privacy Policy</a>
                )}
                {privacyUrl && termsUrl && <span> · </span>}
                {termsUrl && (
                  <a href={termsUrl} target="_blank" rel="noreferrer" className="underline">Terms</a>
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

export function ConfirmStep({
  message,
  address,
  inspectionDate,
  timeWindow,
  customTime,
  selectedServices,
  showInspectorDropdown,
  chosenInspectorName,
  totalPrice,
  clientName,
  clientEmail,
}: {
  message: { text: string; ok: boolean } | null;
  address: string;
  inspectionDate: string;
  timeWindow: string;
  customTime: string;
  selectedServices: Set<string>;
  showInspectorDropdown: boolean;
  chosenInspectorName: string;
  totalPrice: number;
  clientName: string;
  clientEmail: string;
}) {
  return (
    <section className="space-y-5">
      {message?.ok ? (
        <div className="text-center py-8">
          <div className="w-16 h-16 rounded-full bg-ih-ok-bg flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-ih-ok-fg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-ih-fg-1 mb-2">Request Submitted</h2>
          <p className="text-[14px] text-ih-fg-3">{message.text}</p>
        </div>
      ) : (
        <>
          <div className="space-y-1">
            <h2 className="text-[18px] font-semibold tracking-tight text-ih-fg-1">Confirm details</h2>
            <p className="text-[13px] text-ih-fg-3">Review your booking before submitting.</p>
          </div>
          <div className="bg-ih-bg-muted rounded-md p-4 space-y-3 text-[13px]">
            <div className="flex justify-between">
              <span className="text-ih-fg-3">Address</span>
              <span className="font-medium text-ih-fg-1">{address}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-ih-fg-3">Date</span>
              <span className="font-medium text-ih-fg-1">{inspectionDate}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-ih-fg-3">Time</span>
              <span className="font-medium text-ih-fg-1">
                {timeWindow === "custom" ? customTime : TIME_WINDOWS.find((w) => w.id === timeWindow)?.label}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-ih-fg-3">Services</span>
              <span className="font-medium text-ih-fg-1">{selectedServices.size} selected</span>
            </div>
            {showInspectorDropdown && (
              <div className="flex justify-between">
                <span className="text-ih-fg-3">Inspector</span>
                <span className="font-medium text-ih-fg-1">{chosenInspectorName}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-ih-border pt-3">
              <span className="font-bold text-ih-fg-2">Total</span>
              <span className="font-bold text-ih-fg-1">${totalPrice.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-ih-fg-3">Name</span>
              <span className="font-medium text-ih-fg-1">{clientName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-ih-fg-3">Email</span>
              <span className="font-medium text-ih-fg-1">{clientEmail}</span>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
