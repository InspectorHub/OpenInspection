import { Form } from "react-router";
import { RadioCardGroup } from "@core/shared-ui";
import type { useFetcher } from "react-router";
import { SmsSecretsPanel } from "~/components/settings/SmsSecretsPanel";
import type { action } from "~/routes/settings-communication";
import type { ManagedComplianceData } from "~/components/settings/ManagedComplianceWizard";
import type { ConnectionTestResult } from "~/components/settings/ConnectionTestStatus";
import { m } from "~/paraglide/messages";

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
  if (status === "approved") return m.settings_smsdelivery_compliance_approved();
  if (status === "rejected") return m.settings_smsdelivery_compliance_rejected();
  if (
    status === "profile_pending" ||
    status === "brand_pending" ||
    status === "campaign_pending" ||
    status === "tfv_pending"
  ) return m.settings_smsdelivery_compliance_pending();
  return m.settings_smsdelivery_compliance_not_started();
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
  testResults = [],
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
    TELNYX_PUBLIC_KEY: string;
  };
  secretFieldError: (name: string) => string | undefined;
  secretFormError: (intent: string) => string | null;
  savingSmsSecrets: boolean;
  showInboundUrl: boolean;
  inboundUrl: string;
  smsTestFetcher: SmsTestFetcher;
  compliance: ManagedComplianceData;
  byoProvider?: "twilio" | "telnyx";
  /** Persisted "Test connection" history (shared loader list, filtered to sms). */
  testResults?: ConnectionTestResult[];
}) {
  // Toll-free verification is Twilio-specific; Telnyx has a different inbound/
  // compliance flow, so the compliance block below is gated to Twilio.
  const smsProviderLabel = byoProvider === "telnyx" ? m.settings_sms_provider_telnyx() : m.settings_sms_provider_twilio();
  return (
      <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-4">
        <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">{m.settings_smsdelivery_heading()}</h3>
        <p className="text-[13px] text-ih-fg-3">
          {m.settings_smsdelivery_desc()}
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
            <RadioCardGroup
              name="_smsModeRadio"
              value={smsMode}
              onChange={(v) => setSmsMode(v as SmsModeValue)}
              options={[
                {
                  value: "own",
                  title: m.settings_smsdelivery_byo_label(),
                  description: m.settings_smsdelivery_byo_desc(),
                },
                {
                  value: "managed_shared",
                  title: m.settings_smsdelivery_shared_label(),
                  badge: m.settings_smsdelivery_included(),
                  description: m.settings_smsdelivery_shared_desc(),
                },
                {
                  value: "managed_dedicated",
                  title: m.settings_smsdelivery_dedicated_label(),
                  description: m.settings_smsdelivery_dedicated_desc(),
                },
              ]}
            />
          )}
          {!isSaas && (
            <p className="text-[13px] text-ih-fg-3 bg-ih-bg-muted border border-ih-border rounded-md p-3">
              {m.settings_smsdelivery_selfhost_note()}
            </p>
          )}
          <p className="text-[11px] font-bold text-ih-ok-fg">
            {smsConfig.effectiveSource === "own"
              ? m.settings_smsdelivery_using_your({ provider: smsProviderLabel })
              : smsConfig.effectiveSource === "platform"
                ? m.settings_smsdelivery_using_platform()
                : m.settings_smsdelivery_not_configured()}
          </p>

          {/* BYO compliance status — toll-free verification is Twilio-specific,
              so this is gated to own-mode tenants on Twilio. */}
          {smsConfig.effectiveSource === "own" && byoProvider !== "telnyx" && (
            <div className="space-y-1">
              <p className="text-[11px] text-ih-fg-3">
                {m.settings_smsdelivery_tfv_label()}{" "}
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
            <label htmlFor="companyPhone" className="block text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3 mb-1">{m.settings_smsdelivery_company_phone_label()}</label>
            <input
              type="tel" name="companyPhone" id="companyPhone" defaultValue={companyPhone}
              placeholder="+1 555 123 4567"
              className="w-full md:w-1/2 h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
            />
            <p className="text-[11px] text-ih-fg-4 mt-1">{m.settings_smsdelivery_phone_note_prefix()}<code>{"{{company_phone}}"}</code>{m.settings_smsdelivery_phone_note_suffix()}</p>
          </div>

          <div className="flex justify-end pt-3 border-t border-ih-border">
            <button type="submit" disabled={savingSmsConfig}
              className="h-8 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 transition-colors disabled:opacity-60">
              {savingSmsConfig ? m.common_saving() : m.settings_smsdelivery_save()}
            </button>
          </div>
        </Form>

        {(!isSaas || smsMode === "own") && (
          <SmsSecretsPanel
            secrets={secrets}
            secretFieldError={secretFieldError}
            secretFormError={secretFormError}
            savingSmsSecrets={savingSmsSecrets}
            showInboundUrl={showInboundUrl}
            inboundUrl={inboundUrl}
            smsTestFetcher={smsTestFetcher}
            initialProvider={byoProvider ?? "twilio"}
            testResults={testResults}
          />
        )}
      </section>
  );
}
