import { STEPS, type CompanyProfile } from "./booking-constants";
import { useTurnstileWidget } from "~/lib/turnstile";
import { PropertyStep, ServicesStep, ScheduleStep, ConfirmStep } from "./BookingSteps";
import type { useBookingFormState } from "./useBookingFormState";

type BookingFormState = ReturnType<typeof useBookingFormState>;

export function BookingWizard({
  profile,
  privacyUrl,
  form,
}: {
  profile: CompanyProfile;
  privacyUrl: string | null;
  form: BookingFormState;
}) {
  const {
    step, setStep,
    address, setAddress,
    selectedServices,
    inspectionDate, setInspectionDate,
    timeWindow, setTimeWindow,
    customTime, setCustomTime,
    clientName, setClientName,
    clientEmail, setClientEmail,
    smsOptin, setSmsOptin,
    chosenInspectorId, setChosenInspectorId,
    submitting,
    message,
    turnstileToken, setTurnstileToken,
    turnstileRef,
    toggleService,
    totalPrice,
    needsTurnstile,
    canNext,
    inspectorOptions,
    chosenInspectorName,
    handleSubmit,
  } = form;

  useTurnstileWidget(profile.turnstileSiteKey, turnstileRef, step, setTurnstileToken);

  const showInspectorDropdown = inspectorOptions.length > 0;

  return (
    <div className="bg-ih-bg-card rounded-lg shadow-ih-card border border-ih-border p-6 md:p-10">
      <div className="mb-8 space-y-2">
        <h1 className="text-[28px] font-semibold tracking-tight text-ih-fg-1 leading-tight">
          Schedule an inspection
        </h1>
        <p className="text-[14px] text-ih-fg-3 leading-relaxed">
          Tell us about the property and pick a time that works.
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-1 mb-8">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-1 flex-1">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold ${
              i <= step
                ? "bg-ih-primary text-ih-primary-fg"
                : "bg-ih-bg-muted text-ih-fg-4"
            }`}>{i + 1}</div>
            <span className={`text-[11px] font-medium hidden sm:inline ${
              i <= step ? "text-ih-primary" : "text-ih-fg-4"
            }`}>{s}</span>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-px mx-1 ${i < step ? "bg-ih-primary" : "bg-ih-bg-muted"}`} />
            )}
          </div>
        ))}
      </div>

      {/* Step 0: Property */}
      {step === 0 && (
        <PropertyStep address={address} setAddress={setAddress} />
      )}

      {/* Step 1: Services */}
      {step === 1 && (
        <ServicesStep
          profile={profile}
          selectedServices={selectedServices}
          toggleService={toggleService}
          totalPrice={totalPrice}
        />
      )}

      {/* Step 2: Schedule + contact info */}
      {step === 2 && (
        <ScheduleStep
          inspectionDate={inspectionDate}
          setInspectionDate={setInspectionDate}
          timeWindow={timeWindow}
          setTimeWindow={setTimeWindow}
          customTime={customTime}
          setCustomTime={setCustomTime}
          showInspectorDropdown={showInspectorDropdown}
          chosenInspectorId={chosenInspectorId}
          setChosenInspectorId={setChosenInspectorId}
          inspectorOptions={inspectorOptions}
          clientName={clientName}
          setClientName={setClientName}
          clientEmail={clientEmail}
          setClientEmail={setClientEmail}
          smsOptin={smsOptin}
          setSmsOptin={setSmsOptin}
        />
      )}

      {/* Step 3: Confirm */}
      {step === 3 && (
        <ConfirmStep
          message={message}
          address={address}
          inspectionDate={inspectionDate}
          timeWindow={timeWindow}
          customTime={customTime}
          selectedServices={selectedServices}
          showInspectorDropdown={showInspectorDropdown}
          chosenInspectorName={chosenInspectorName}
          totalPrice={totalPrice}
          clientName={clientName}
          clientEmail={clientEmail}
        />
      )}

      {/* Turnstile — shown on confirm step */}
      {step === 3 && needsTurnstile && (
        <div className="mt-6 flex justify-center">
          <div ref={turnstileRef} />
        </div>
      )}

      {/* Message display */}
      {message && !message.ok && (
        <div className="mt-6 p-3 rounded-md bg-ih-bad-bg text-center text-[13px] font-semibold text-ih-bad-fg">
          {message.text}
        </div>
      )}

      {/* Navigation footer */}
      {!(step === 3 && message?.ok) && (
        <div className="flex items-center justify-between mt-8 pt-6 border-t border-ih-border">
          <button
            onClick={() => step > 0 ? setStep(step - 1) : undefined}
            disabled={step === 0}
            className="h-9 px-4 rounded-md border border-ih-border text-[13px] font-medium text-ih-fg-3 hover:bg-ih-bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            Back
          </button>
          {step < 3 ? (
            <button
              onClick={() => setStep(step + 1)}
              disabled={!canNext}
              className="h-9 px-5 rounded-md bg-ih-primary text-ih-primary-fg font-bold text-[13px] hover:bg-ih-primary-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Continue
            </button>
          ) : (
            <div className="text-right">
              <p className="mb-2 text-xs text-ih-fg-3">
                Your information is shared with {profile.company} to schedule your inspection.
                {privacyUrl && <> See our <a href={privacyUrl} target="_blank" rel="noreferrer" className="underline">Privacy Policy</a>.</>}
              </p>
              <button
                onClick={handleSubmit}
                disabled={submitting || (needsTurnstile && !turnstileToken)}
                className="h-9 px-5 rounded-md bg-ih-primary text-ih-primary-fg font-bold text-[13px] hover:bg-ih-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {submitting ? "Submitting..." : "Request Inspection"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
