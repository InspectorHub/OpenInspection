import { Form } from "react-router";
import { Button } from "@core/shared-ui";
import type { useFetcher } from "react-router";
import { SmsSecretsPanel } from "~/components/settings/SmsSecretsPanel";
import { FoldedAccountDetails } from "~/components/settings/integrations/FoldedAccountDetails";
import type { action } from "~/routes/settings-integrations-sms";
import type { ManagedComplianceData } from "~/components/settings/ManagedComplianceWizard";
import type { ConnectionTestResult } from "~/components/settings/ConnectionTestStatus";
import { m } from "~/paraglide/messages";
import { useSubmitLatch } from "~/hooks/useSubmitLatch";

type SmsTestFetcher = ReturnType<typeof useFetcher<typeof action>>;

type ComplianceStatus = ManagedComplianceData["complianceStatus"];

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
 * Integrations -> SMS, below the connection card and the source choice:
 * the company phone, the registration status of the company's own number, and
 * the account details (provider, keys, inbound address, test message).
 *
 * Whose account sends the SMS is chosen above this panel; nothing here changes
 * it. The account details are shown while "Your own" is the question and folded
 * once they are complete. When Built-in is selected they stay saved, out of
 * sight, and this panel says so.
 */
export function SmsDeliveryPanel({
  effectiveSource,
  companyPhone,
  savingSmsConfig,
  byoProvider,
  compliance,
  showAccountDetails,
  accountComplete,
  secrets,
  secretFieldError,
  secretFormError,
  savingSmsSecrets,
  showInboundUrl,
  inboundUrl,
  smsTestFetcher,
  testResults = [],
}: {
  /** Whose number the SMS goes out on now. */
  effectiveSource: "platform" | "own" | "managed" | "none";
  companyPhone: string;
  savingSmsConfig: boolean;
  byoProvider: "twilio" | "telnyx";
  compliance: ManagedComplianceData;
  showAccountDetails: boolean;
  accountComplete: boolean;
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
  /** Persisted "Test connection" history (shared loader list, filtered to sms). */
  testResults?: ConnectionTestResult[];
}) {
  const latch = useSubmitLatch();
  // Toll-free verification is Twilio-specific; Telnyx has a different inbound/
  // compliance flow, so the status below is shown for Twilio only.
  const showVerification = effectiveSource === "own" && byoProvider !== "telnyx";
  return (
    <section className="space-y-ih-list">
      {showVerification && (
        <div className="space-y-1" data-testid="sms-verification">
          <p className="text-xs text-ih-fg-3">
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
            <p className="text-xs text-ih-bad-fg">{compliance.rejectionReason}</p>
          )}
        </div>
      )}

      <Form method="post" onSubmit={latch()} className="bg-ih-bg-card border border-ih-border rounded-ih-card p-5 space-y-3">
        <input type="hidden" name="intent" value="save-sms-config" />
        <div>
          <label htmlFor="companyPhone" className="block text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3 mb-1">{m.settings_smsdelivery_company_phone_label()}</label>
          <input
            type="tel" name="companyPhone" id="companyPhone" defaultValue={companyPhone}
            placeholder="+1 555 123 4567"
            className="w-full md:w-1/2 h-9 px-3 rounded-ih-button border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
          />
          <p className="text-xs text-ih-fg-3 mt-1">{m.settings_smsdelivery_phone_note_prefix()}<code>{"{{company_phone}}"}</code>{m.settings_smsdelivery_phone_note_suffix()}</p>
        </div>
        <div className="flex justify-end">
          <Button type="submit" variant="primary" pending={savingSmsConfig}>
            {savingSmsConfig ? m.common_saving() : m.settings_smsdelivery_save()}
          </Button>
        </div>
      </Form>

      {showAccountDetails ? (
        <FoldedAccountDetails complete={accountComplete}>
          <div className="bg-ih-bg-card border border-ih-border rounded-ih-card p-5 space-y-4">
            <SmsSecretsPanel
              secrets={secrets}
              secretFieldError={secretFieldError}
              secretFormError={secretFormError}
              savingSmsSecrets={savingSmsSecrets}
              showInboundUrl={showInboundUrl}
              inboundUrl={inboundUrl}
              smsTestFetcher={smsTestFetcher}
              initialProvider={byoProvider}
              testResults={testResults}
            />
          </div>
        </FoldedAccountDetails>
      ) : (
        <p className="text-xs text-ih-fg-3">{m.integrations_delivery_keys_kept()}</p>
      )}
    </section>
  );
}
