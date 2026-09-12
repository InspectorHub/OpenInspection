import { useState } from "react";
import { stepLabels, type CompanyProfile } from "./booking-constants";
import { useTurnstileWidget } from "~/lib/turnstile";
import { PropertyStep, ServicesStep, ScheduleStep, ConfirmStep } from "./BookingSteps";
import { BOOKING_DROPDOWN_OBSTACLE_ATTR } from "./PublicAddressAutocomplete";
import type { useBookingFormState } from "./useBookingFormState";
import { m } from "~/paraglide/messages";

type BookingFormState = ReturnType<typeof useBookingFormState>;

export function BookingWizard({
  profile,
  privacyUrl,
  termsUrl,
  form,
  agentBooking,
}: {
  profile: CompanyProfile;
  privacyUrl: string | null;
  termsUrl: string | null;
  form: BookingFormState;
  /** Set when a signed-in agent is booking on behalf of a client. */
  agentBooking?: { agentName: string; tenantId: string } | null;
}) {
  const {
    step, setStep,
    address, setAddress, setAddressPick,
    selectedServices,
    inspectionDate, setInspectionDate,
    timeWindow, setTimeWindow,
    customTime, setCustomTime,
    clientName, setClientName,
    clientEmail, setClientEmail,
    smsOptin, setSmsOptin,
    locale, setLocale,
    chosenInspectorId, setChosenInspectorId,
    submitting,
    message,
    turnstileToken, setTurnstileToken,
    turnstileRef,
    toggleService,
    totalPrice,
    depositQuoteCents,
    depositDueCents,
    bookedInspectionId,
    currency,
    needsTurnstile,
    canNext,
    dateIssue,
    setDateUnbookable,
    selectedServiceNames,
    inspectorOptions,
    chosenInspectorName,
    handleSubmit,
    tenant,
    prefilledFromDevice,
    clearRememberedContact,
    rememberContact,
  } = form;

  /**
   * Why the last click could not go through, said out loud.
   *
   * The submit used to carry `disabled={submitting || (needsTurnstile &&
   * !turnstileToken)}`, so on the confirm step — where every field is already
   * filled — a client could meet a greyed-out button, no visible widget, and
   * no explanation. If the challenge script cannot load at all, that state is
   * permanent and silent, on the last button in the acquisition funnel.
   *
   * GOV.UK: "avoid them if possible". NN/g, the one authority that permits
   * disabling: "A disabled control must not be a communication dead end", and
   * for forms, "allow the primary action and show errors as needed". The staff
   * wizard in this app already states its reason beside a disabled Next; the
   * agent signup keeps its submit live and reports the unticked terms after
   * the click. This is the client-facing flow catching up.
   */
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifyUnavailable, setVerifyUnavailable] = useState(false);

  useTurnstileWidget(profile.turnstileSiteKey, turnstileRef, step, setTurnstileToken, {
    onLoadFailed: () => setVerifyUnavailable(true),
  });

  const showInspectorDropdown = inspectorOptions.length > 0;
  const serviceIds = [...selectedServices];

  return (
    <div className="bg-ih-bg-card rounded-lg shadow-ih-card border border-ih-border p-6 md:p-10">
      <div className="mb-8 space-y-2">
        <h1 className="text-[28px] font-semibold tracking-tight text-ih-fg-1 leading-tight">
          {m.booking_wizard_heading()}
        </h1>
        <p className="text-[14px] text-ih-fg-3 leading-relaxed">
          {m.booking_wizard_subtitle()}
        </p>
      </div>

      {/* Booking on behalf of someone else changes what the contact fields
          mean and what happens next, so say so before the first question. */}
      {agentBooking && (
        <div className="mb-8 rounded-lg border border-ih-border bg-ih-bg-muted px-4 py-3">
          <p className="text-[13px] font-semibold text-ih-fg-1">
            {m.booking_agent_on_behalf_heading({ name: agentBooking.agentName })}
          </p>
          <p className="text-[12px] text-ih-fg-3 mt-0.5">{m.booking_agent_on_behalf_body()}</p>
        </div>
      )}

      {/* Step indicator */}
      <div className="flex items-center gap-1 mb-8">
        {stepLabels().map((s, i) => (
          <div key={s} className="flex items-center gap-1 flex-1">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold ${
              i <= step
                ? "bg-ih-primary text-ih-primary-fg"
                : "bg-ih-bg-muted text-ih-fg-2"
            }`}>{i + 1}</div>
            <span className={`text-[11px] font-medium hidden sm:inline ${
              i <= step ? "text-ih-primary-text" : "text-ih-fg-3"
            }`}>{s}</span>
            {i < stepLabels().length - 1 && (
              <div className={`flex-1 h-px mx-1 ${i < step ? "bg-ih-primary" : "bg-ih-bg-muted"}`} />
            )}
          </div>
        ))}
      </div>

      {/* Step 0: Property */}
      {step === 0 && (
        <PropertyStep address={address} setAddress={setAddress} onSelectAddress={setAddressPick} />
      )}

      {/* Step 1: Services */}
      {step === 1 && (
        <ServicesStep
          profile={profile}
          selectedServices={selectedServices}
          toggleService={toggleService}
          totalPrice={totalPrice}
          depositQuoteCents={depositQuoteCents}
          currency={currency}
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
          locale={locale}
          setLocale={setLocale}
          privacyUrl={privacyUrl}
          termsUrl={termsUrl}
          companyName={profile.company}
          tenant={tenant}
          serviceIds={serviceIds}
          conciergeReviewRequired={!!profile.conciergeReviewRequired}
          contactIsSelf={rememberContact}
          prefilledFromDevice={prefilledFromDevice}
          onClearRememberedContact={clearRememberedContact}
          dateIssue={dateIssue}
          onDateBookableChange={setDateUnbookable}
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
          selectedServiceNames={selectedServiceNames}
          showInspectorDropdown={showInspectorDropdown}
          chosenInspectorName={chosenInspectorName}
          totalPrice={totalPrice}
          clientName={clientName}
          clientEmail={clientEmail}
          depositQuoteCents={depositQuoteCents}
          depositDueCents={depositDueCents}
          bookedInspectionId={bookedInspectionId}
          currency={currency}
          companyName={profile.company}
        />
      )}

      {/* Turnstile — shown on confirm step */}
      {step === 3 && needsTurnstile && (
        <div className="mt-6 flex justify-center">
          <div ref={turnstileRef} />
        </div>
      )}

      {/* Why the form is not going through. `verifyUnavailable` announces
          itself without waiting for a click: a challenge that cannot load is
          not something the client can fix by trying harder, and leaving them
          to discover it by pressing a button that does nothing is the silence
          this replaces.

          The copy names no direction. This paragraph renders BELOW the widget
          it refers to, so an earlier "the verification below" pointed the
          client past it at the footer — and any wording that encodes a
          position goes stale the next time this block moves. */}
      {step === 3 && (verifyError || verifyUnavailable) && (
        <p
          role="alert"
          className="mt-3 text-center text-[13px] font-semibold text-ih-bad-fg"
        >
          {verifyError ?? m.booking_verify_unavailable()}
        </p>
      )}

      {/* Message display */}
      {message && !message.ok && (
        <div className="mt-6 p-3 rounded-md bg-ih-bad-bg text-center text-[13px] font-semibold text-ih-bad-fg">
          {message.text}
        </div>
      )}

      {/* Navigation footer.

          The obstacle attribute is load-bearing, not decorative: the address
          typeahead reads it to keep its suggestion list off Continue (F41). The
          list used to cover the button completely, so a visitor reaching for it
          picked a different address instead and was never told. */}
      {!(step === 3 && message?.ok) && (
        <div
          {...{ [BOOKING_DROPDOWN_OBSTACLE_ATTR]: "" }}
          className="flex items-center justify-between mt-8 pt-6 border-t border-ih-border"
        >
          <button
            onClick={() => step > 0 ? setStep(step - 1) : undefined}
            disabled={step === 0}
            className="h-9 px-4 rounded-md border border-ih-border text-[13px] font-medium text-ih-fg-3 hover:bg-ih-bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            {m.common_back()}
          </button>
          {step < 3 ? (
            <button
              onClick={() => setStep(step + 1)}
              disabled={!canNext}
              className="h-9 px-5 rounded-md bg-ih-primary text-ih-primary-fg font-bold text-[13px] hover:bg-ih-primary-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {m.common_continue()}
            </button>
          ) : (
            <div className="text-right">
              <p className="mb-2 text-xs text-ih-fg-3">
                {m.booking_privacy_shared_notice({ name: profile.company })}
                {privacyUrl && <> {m.booking_privacy_see_our()} <a href={privacyUrl} target="_blank" rel="noreferrer" className="underline">{m.booking_link_privacy_policy()}</a>.</>}
              </p>
              <button
                onClick={() => {
                  if (needsTurnstile && !turnstileToken) {
                    setVerifyError(
                      verifyUnavailable
                        ? m.booking_verify_unavailable()
                        : m.booking_verify_required(),
                    );
                    return;
                  }
                  setVerifyError(null);
                  handleSubmit();
                }}
                // Only the in-flight guard remains: the action has already been
                // taken and this stops it being sent twice, which is a
                // different question from "you may not act yet".
                disabled={submitting}
                className="h-9 px-5 rounded-md bg-ih-primary text-ih-primary-fg font-bold text-[13px] hover:bg-ih-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {submitting ? m.booking_submitting() : m.booking_wizard_submit()}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
