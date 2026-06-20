import { Form } from "react-router";
import type { useFetcher } from "react-router";
import { SmsSecretsPanel } from "~/components/settings/SmsSecretsPanel";
import type { action } from "~/routes/settings-communication";

type SmsTestFetcher = ReturnType<typeof useFetcher<typeof action>>;

/**
 * Settings → Communication: "SMS delivery" section (Track L). Presentational —
 * owns the section wrapper, mode/company-phone form, and renders the Twilio
 * secrets + inbound + test sub-panel inside the same <section>. Self-host gating
 * (`isSaas`) is threaded verbatim from the route.
 */
export function SmsDeliveryPanel({
  isSaas,
  smsMode,
  setSmsMode,
  smsConfig,
  companyPhone,
  savingSmsConfig,
  secrets,
  secretFieldError,
  secretFormError,
  savingSmsSecrets,
  showInboundUrl,
  inboundUrl,
  smsTestFetcher,
}: {
  isSaas: boolean;
  smsMode: "platform" | "own";
  setSmsMode: (m: "platform" | "own") => void;
  smsConfig: { mode: "platform" | "own"; effectiveSource: "platform" | "own" | "none" };
  companyPhone: string;
  savingSmsConfig: boolean;
  secrets: {
    TWILIO_ACCOUNT_SID: string;
    TWILIO_AUTH_TOKEN: string;
    TWILIO_FROM_NUMBER: string;
  };
  secretFieldError: (name: string) => string | undefined;
  secretFormError: (intent: string) => string | null;
  savingSmsSecrets: boolean;
  showInboundUrl: boolean;
  inboundUrl: string;
  smsTestFetcher: SmsTestFetcher;
}) {
  return (
      <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-4">
        <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">SMS delivery</h3>
        <p className="text-[13px] text-ih-fg-3">
          Send appointment and report text messages via Twilio. Clients are texted only
          after they opt in (STOP replies are honored automatically). You pay Twilio&rsquo;s
          per-message rates directly.
        </p>

        {/* Mode + company phone */}
        <Form method="post" className="space-y-4">
          <input type="hidden" name="intent" value="save-sms-config" />
          <input type="hidden" name="smsMode" value={smsMode} />

          {/* Mode switch — SaaS only. Self-host has no platform SMS sender, so
              the mode is forced to `own` (the hidden smsMode input above) and
              the toggle hides. */}
          {isSaas && (
            <div className="inline-flex rounded-md border border-ih-border overflow-hidden">
              {(["platform", "own"] as const).map((m) => (
                <button
                  type="button" key={m} onClick={() => setSmsMode(m)}
                  className={`px-3 h-8 flex items-center text-[12px] font-bold ${smsMode === m ? "bg-ih-primary text-white" : "bg-ih-bg-card text-ih-fg-2"}`}
                >
                  {m === "platform" ? "Platform SMS" : "My own Twilio"}
                </button>
              ))}
            </div>
          )}
          {!isSaas && (
            <p className="text-[13px] text-ih-fg-3 bg-ih-bg-muted border border-ih-border rounded-md p-3">
              Self-hosted deployments text from your own Twilio account. Add your Twilio
              credentials below to enable SMS.
            </p>
          )}
          <p className="text-[11px] font-bold text-ih-ok-fg">
            {smsConfig.effectiveSource === "own"
              ? "Using your Twilio"
              : smsConfig.effectiveSource === "platform"
                ? "Using platform SMS"
                : "SMS not configured — set your Twilio credentials below"}
          </p>

          <div>
            <label htmlFor="companyPhone" className="block text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3 mb-1">Company phone</label>
            <input
              type="tel" name="companyPhone" id="companyPhone" defaultValue={companyPhone}
              placeholder="+1 555 123 4567"
              className="w-full md:w-1/2 h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
            />
            <p className="text-[11px] text-ih-fg-4 mt-1">Shown in your texts as the call-back number (<code>{"{{company_phone}}"}</code>).</p>
          </div>

          <div className="flex justify-end pt-3 border-t border-ih-border">
            <button type="submit" disabled={savingSmsConfig}
              className="h-8 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 transition-colors disabled:opacity-60">
              {savingSmsConfig ? "Saving…" : "Save SMS settings"}
            </button>
          </div>
        </Form>

        <SmsSecretsPanel
          secrets={secrets}
          secretFieldError={secretFieldError}
          secretFormError={secretFormError}
          savingSmsSecrets={savingSmsSecrets}
          showInboundUrl={showInboundUrl}
          inboundUrl={inboundUrl}
          smsTestFetcher={smsTestFetcher}
        />
      </section>
  );
}
