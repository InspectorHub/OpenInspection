import { Form } from "react-router";
import type { useFetcher } from "react-router";
import { SmsSecretsPanel } from "~/components/settings/SmsSecretsPanel";
import type { action } from "~/routes/settings-communication";

type SmsTestFetcher = ReturnType<typeof useFetcher<typeof action>>;

type ComplianceStatus =
  | "not_started"
  | "profile_pending"
  | "brand_pending"
  | "campaign_pending"
  | "tfv_pending"
  | "approved"
  | "rejected";

export type SmsModeValue = "own" | "managed_shared" | "managed_dedicated";

/**
 * Maps a complianceStatus value to a short human-readable label.
 * pending-family statuses all collapse to "Pending" (toll-free verification,
 * brand/campaign registration are all intermediate states).
 */
function complianceLabel(status: ComplianceStatus | null): string {
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Rejected";
  if (
    status === "profile_pending" ||
    status === "brand_pending" ||
    status === "campaign_pending" ||
    status === "tfv_pending"
  ) return "Pending";
  return "Not started";
}

/**
 * Settings → Communication: "SMS delivery" section (Track L). Presentational —
 * owns the section wrapper, mode/company-phone form, and renders the Twilio
 * secrets + inbound + test sub-panel inside the same <section>. Self-host gating
 * (`isSaas`) is threaded verbatim from the route.
 *
 * SaaS tenants select from three modes:
 *   - "own" (BYO Twilio/Telnyx) — fully wired end-to-end
 *   - "managed_shared" — managed shared number (default; send path in later plan)
 *   - "managed_dedicated" — dedicated local number, gated/disabled upgrade
 * "platform" is a legacy/first-party value stored in DB; it is never offered as
 * a tenant choice — the server rejects it if submitted.
 * Standalone deployments show only the BYO option (mode is forced to "own").
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
  compliance,
  byoProvider,
}: {
  isSaas: boolean;
  smsMode: SmsModeValue;
  setSmsMode: (m: SmsModeValue) => void;
  smsConfig: { mode: "platform" | "own" | "managed_shared" | "managed_dedicated"; effectiveSource: "platform" | "own" | "none" };
  companyPhone: string;
  savingSmsConfig: boolean;
  secrets: {
    TWILIO_ACCOUNT_SID: string;
    TWILIO_AUTH_TOKEN: string;
    TWILIO_FROM_NUMBER: string;
    TELNYX_API_KEY: string;
    TELNYX_FROM_NUMBER: string;
  };
  secretFieldError: (name: string) => string | undefined;
  secretFormError: (intent: string) => string | null;
  savingSmsSecrets: boolean;
  showInboundUrl: boolean;
  inboundUrl: string;
  smsTestFetcher: SmsTestFetcher;
  compliance: { complianceStatus: ComplianceStatus; rejectionReason: string | null };
  byoProvider?: "twilio" | "telnyx";
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

          {/* Mode switch — SaaS only. Self-host is BYO-only; the mode is
              forced to "own" (the hidden smsMode input above) and the selector
              is hidden. "platform" is a first-party-only value that is never
              presented as a tenant option. */}
          {isSaas && (
            <div className="space-y-2">
              <div className="flex flex-col gap-2">
                {/* BYO */}
                <label className={`flex items-start gap-3 p-3 rounded-md border cursor-pointer transition-colors ${smsMode === "own" ? "border-ih-primary bg-ih-primary/5" : "border-ih-border bg-ih-bg-card hover:border-ih-primary/40"}`}>
                  <input
                    type="radio" name="_smsModeRadio" value="own"
                    checked={smsMode === "own"}
                    onChange={() => setSmsMode("own")}
                    className="mt-0.5 accent-ih-primary"
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] font-bold text-ih-fg-1">My own Twilio / Telnyx (BYO)</span>
                    <span className="block text-[11px] text-ih-fg-3 mt-0.5">Bring your own account. You pay provider rates directly and control your numbers.</span>
                  </span>
                </label>
                {/* Managed shared */}
                <label className={`flex items-start gap-3 p-3 rounded-md border cursor-pointer transition-colors ${smsMode === "managed_shared" ? "border-ih-primary bg-ih-primary/5" : "border-ih-border bg-ih-bg-card hover:border-ih-primary/40"}`}>
                  <input
                    type="radio" name="_smsModeRadio" value="managed_shared"
                    checked={smsMode === "managed_shared"}
                    onChange={() => setSmsMode("managed_shared")}
                    className="mt-0.5 accent-ih-primary"
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] font-bold text-ih-fg-1">Managed — shared number <span className="font-normal text-ih-ok-fg">(included)</span></span>
                    <span className="block text-[11px] text-ih-fg-3 mt-0.5">Send from a platform-managed shared number. No setup needed.</span>
                  </span>
                </label>
                {/* Managed dedicated — gated/disabled upgrade */}
                <label className="flex items-start gap-3 p-3 rounded-md border border-ih-border bg-ih-bg-muted opacity-60 cursor-not-allowed" aria-disabled="true">
                  <input
                    type="radio" name="_smsModeRadio" value="managed_dedicated"
                    checked={smsMode === "managed_dedicated"}
                    onChange={() => setSmsMode("managed_dedicated")}
                    className="mt-0.5 accent-ih-primary"
                    disabled
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] font-bold text-ih-fg-2">Managed — dedicated local number <span className="inline-block ml-1 px-1.5 py-px rounded text-[10px] font-bold uppercase tracking-wide bg-ih-bg-card border border-ih-border text-ih-fg-3">Paid upgrade</span></span>
                    <span className="block text-[11px] text-ih-fg-4 mt-0.5">Your own local number, managed by the platform. Available on a higher plan.</span>
                  </span>
                </label>
              </div>
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

          {/* BYO Twilio compliance status — only shown when tenant uses own Twilio */}
          {smsConfig.effectiveSource === "own" && (
            <div className="space-y-1">
              <p className="text-[11px] text-ih-fg-3">
                Toll-free verification:{" "}
                <span
                  className={`font-bold ${
                    compliance.complianceStatus === "approved"
                      ? "text-ih-ok-fg"
                      : compliance.complianceStatus === "rejected"
                        ? "text-ih-bad-fg"
                        : "text-ih-fg-2"
                  }`}
                >
                  {complianceLabel(compliance.complianceStatus)}
                </span>
              </p>
              {compliance.complianceStatus === "rejected" && compliance.rejectionReason && (
                <p className="text-[11px] text-ih-bad-fg">{compliance.rejectionReason}</p>
              )}
            </div>
          )}

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
          initialProvider={byoProvider ?? "twilio"}
        />
      </section>
  );
}
