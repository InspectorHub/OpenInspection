import { useState } from "react";
import { Form } from "react-router";
import type { useFetcher } from "react-router";
import { SecretField } from "~/components/SecretField";
import { ConnectionTestStatus, type ConnectionTestResult } from "~/components/settings/ConnectionTestStatus";
import type { action } from "~/routes/settings-communication";
import { m } from "~/paraglide/messages";

type SmsTestFetcher = ReturnType<typeof useFetcher<typeof action>>;

type ByoProvider = "twilio" | "telnyx";

/**
 * Settings → Communication: BYO SMS provider selector + credentials + inbound
 * webhook URL + test-SMS controls. Presentational sibling of SmsDeliveryPanel
 * (rendered inside the same SMS <section>); the route owns secrets, pending
 * state, fetcher, and the resolved inbound URL.
 *
 * The provider selector lets tenants choose between Twilio (default) and Telnyx.
 * The selected provider is submitted as a hidden `sms_byo_provider` field, which the
 * `save-sms-secrets` action reads to persist the choice and route the credentials.
 */
export function SmsSecretsPanel({
  secrets,
  secretFieldError,
  secretFormError,
  savingSmsSecrets,
  showInboundUrl,
  inboundUrl,
  smsTestFetcher,
  initialProvider = "twilio",
  testResults = [],
}: {
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
  initialProvider?: ByoProvider;
  /** Persisted "Test connection" history (shared loader list, filtered to sms). */
  testResults?: ConnectionTestResult[];
}) {
  const [provider, setProvider] = useState<ByoProvider>(initialProvider);

  return (
    <>
        {/* Provider selector + credentials */}
        <Form method="post" className="space-y-4 pt-4 border-t border-ih-border">
          <input type="hidden" name="intent" value="save-sms-secrets" />
          {/* Hidden field carries the selected provider so the action can read it */}
          <input type="hidden" name="sms_byo_provider" value={provider} />

          {/* Provider choice */}
          <div className="space-y-1.5">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3">{m.settings_smssecrets_provider_label()}</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setProvider("twilio")}
                className={`flex-1 h-9 rounded-md border text-[13px] font-bold transition-colors ${
                  provider === "twilio"
                    ? "border-ih-primary bg-ih-primary/5 text-ih-primary"
                    : "border-ih-border bg-ih-bg-card text-ih-fg-2 hover:border-ih-primary/40"
                }`}
              >
                {m.settings_sms_provider_twilio()}
              </button>
              <button
                type="button"
                onClick={() => setProvider("telnyx")}
                className={`flex-1 h-9 rounded-md border text-[13px] font-bold transition-colors ${
                  provider === "telnyx"
                    ? "border-ih-primary bg-ih-primary/5 text-ih-primary"
                    : "border-ih-border bg-ih-bg-card text-ih-fg-2 hover:border-ih-primary/40"
                }`}
              >
                {m.settings_sms_provider_telnyx()}
              </button>
            </div>
          </div>

          {/* Twilio credential fields */}
          {provider === "twilio" && (
            <>
              <p className="text-[13px] text-ih-fg-3">
                {m.settings_smssecrets_twilio_intro()}{" "}
                <a href="https://www.twilio.com/docs/messaging/compliance/a2p-10dlc" target="_blank" rel="noopener noreferrer" className="text-ih-primary hover:underline">{m.settings_smssecrets_a2p_link()}</a>{" "}
                {m.settings_smssecrets_twilio_intro_suffix()}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <SecretField name="TWILIO_ACCOUNT_SID" label={m.settings_smssecrets_twilio_sid_label()}
                  value={secrets.TWILIO_ACCOUNT_SID} error={secretFieldError("TWILIO_ACCOUNT_SID")}
                  hint={m.settings_smssecrets_twilio_sid_hint()} />
                <SecretField name="TWILIO_AUTH_TOKEN" label={m.settings_smssecrets_twilio_token_label()}
                  value={secrets.TWILIO_AUTH_TOKEN} error={secretFieldError("TWILIO_AUTH_TOKEN")}
                  hint={m.settings_smssecrets_twilio_token_hint()} />
                <SecretField name="TWILIO_FROM_NUMBER" label={m.settings_smssecrets_twilio_from_label()}
                  value={secrets.TWILIO_FROM_NUMBER} error={secretFieldError("TWILIO_FROM_NUMBER")}
                  hint={m.settings_smssecrets_twilio_from_hint()} />
              </div>
            </>
          )}

          {/* Telnyx credential fields */}
          {provider === "telnyx" && (
            <>
              <p className="text-[13px] text-ih-fg-3">
                {m.settings_smssecrets_telnyx_intro()}{" "}
                <a href="https://portal.telnyx.com/" target="_blank" rel="noopener noreferrer" className="text-ih-primary hover:underline">{m.settings_smssecrets_telnyx_portal_link()}</a>{m.settings_smssecrets_telnyx_intro_suffix()}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <SecretField name="TELNYX_API_KEY" label={m.settings_smssecrets_telnyx_key_label()}
                  value={secrets.TELNYX_API_KEY} error={secretFieldError("TELNYX_API_KEY")}
                  hint={m.settings_smssecrets_telnyx_key_hint()} />
                <SecretField name="TELNYX_FROM_NUMBER" label={m.settings_smssecrets_telnyx_from_label()}
                  value={secrets.TELNYX_FROM_NUMBER} error={secretFieldError("TELNYX_FROM_NUMBER")}
                  hint={m.settings_smssecrets_telnyx_from_hint()} />
                <SecretField name="TELNYX_PUBLIC_KEY" label={m.settings_smssecrets_telnyx_pubkey_label()}
                  value={secrets.TELNYX_PUBLIC_KEY} error={secretFieldError("TELNYX_PUBLIC_KEY")}
                  hint={m.settings_smssecrets_telnyx_pubkey_hint()} />
              </div>
            </>
          )}

          {secretFormError("save-sms-secrets") && (
            <p className="text-[12px] text-ih-bad-fg">{secretFormError("save-sms-secrets")}</p>
          )}
          <div className="flex justify-end pt-3 border-t border-ih-border">
            <button type="submit" disabled={savingSmsSecrets}
              className="h-8 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 transition-colors disabled:opacity-60">
              {savingSmsSecrets ? m.common_saving() : m.settings_smssecrets_save({ provider: provider === "twilio" ? m.settings_sms_provider_twilio() : m.settings_sms_provider_telnyx() })}
            </button>
          </div>
        </Form>

        {/* Inbound webhook URL (own number / standalone only) */}
        {showInboundUrl && (
          <div className="pt-4 border-t border-ih-border space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3">{m.settings_smssecrets_inbound_label()}</p>
            <div className="flex items-center gap-2">
              <input
                type="text" readOnly value={inboundUrl || m.settings_smssecrets_inbound_placeholder()}
                className="flex-1 h-8 px-2 rounded-md border border-ih-border bg-ih-bg-muted text-[11px] font-mono text-ih-fg-3 outline-none"
              />
              <button type="button" disabled={!inboundUrl}
                onClick={() => { if (inboundUrl) void navigator.clipboard.writeText(inboundUrl); }}
                className="h-8 px-3 rounded-md bg-ih-primary text-white font-bold text-[12px] hover:bg-ih-primary-600 transition-colors shrink-0 disabled:opacity-60">
                {m.common_copy()}
              </button>
            </div>
            <p className="text-[11px] text-ih-fg-4">
              {provider === "telnyx"
                ? m.settings_smssecrets_inbound_note_telnyx()
                : m.settings_smssecrets_inbound_note_twilio()}
            </p>
          </div>
        )}

        {/* Send test SMS */}
        <smsTestFetcher.Form method="post" className="flex flex-wrap items-end gap-3 pt-4 border-t border-ih-border">
          <input type="hidden" name="intent" value="test-sms" />
          <div className="flex-1 min-w-[200px]">
            <label htmlFor="sms-test-to" className="block text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3 mb-1">{m.settings_smssecrets_test_label()}</label>
            <input
              type="tel" name="to" id="sms-test-to" placeholder="+15551234567"
              className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
            />
          </div>
          <button type="submit" disabled={smsTestFetcher.state !== "idle"}
            className="h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[12px] font-bold text-ih-fg-2 hover:bg-ih-bg-muted transition-colors disabled:opacity-60">
            {smsTestFetcher.state !== "idle" ? m.settings_smssecrets_sending() : m.settings_smssecrets_send_test()}
          </button>
          {smsTestFetcher.data && "intent" in smsTestFetcher.data && smsTestFetcher.data.intent === "test-sms" && "ok" in smsTestFetcher.data && (
            smsTestFetcher.data.ok
              ? <span className="text-[12px] text-ih-ok-fg">{m.settings_smssecrets_test_sent()}</span>
              : <span className="text-[12px] text-ih-bad-fg">{smsTestFetcher.data.error}</span>
          )}
        </smsTestFetcher.Form>
        {/* Persisted last-tested status + recent history (survives reloads). */}
        <div className="pt-2">
          <ConnectionTestStatus results={testResults} target="sms" />
        </div>
    </>
  );
}
