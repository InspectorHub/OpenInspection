import { useState } from "react";
import { Form } from "react-router";
import type { useFetcher } from "react-router";
import { SecretField } from "~/components/SecretField";
import { ConnectionTestStatus, type ConnectionTestResult } from "~/components/settings/ConnectionTestStatus";
import type { action } from "~/routes/settings-communication";

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
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3">SMS provider</p>
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
                Twilio
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
                Telnyx
              </button>
            </div>
          </div>

          {/* Twilio credential fields */}
          {provider === "twilio" && (
            <>
              <p className="text-[13px] text-ih-fg-3">
                Add your Twilio Account SID, Auth Token, and a sending number. New numbers must be
                registered for{" "}
                <a href="https://www.twilio.com/docs/messaging/compliance/a2p-10dlc" target="_blank" rel="noopener noreferrer" className="text-ih-primary hover:underline">A2P 10DLC</a>{" "}
                before they can text US numbers.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <SecretField name="TWILIO_ACCOUNT_SID" label="Twilio Account SID"
                  value={secrets.TWILIO_ACCOUNT_SID} error={secretFieldError("TWILIO_ACCOUNT_SID")}
                  hint="Starts with AC, 34 chars. Twilio Console → Account Info" />
                <SecretField name="TWILIO_AUTH_TOKEN" label="Twilio Auth Token"
                  value={secrets.TWILIO_AUTH_TOKEN} error={secretFieldError("TWILIO_AUTH_TOKEN")}
                  hint="Paired with the Account SID. Also verifies inbound STOP/START webhooks." />
                <SecretField name="TWILIO_FROM_NUMBER" label="Twilio From Number"
                  value={secrets.TWILIO_FROM_NUMBER} error={secretFieldError("TWILIO_FROM_NUMBER")}
                  hint="Your sending number in E.164, e.g. +15551234567" />
              </div>
            </>
          )}

          {/* Telnyx credential fields */}
          {provider === "telnyx" && (
            <>
              <p className="text-[13px] text-ih-fg-3">
                Add your Telnyx API key, sending number, and public key. Configure your number in the{" "}
                <a href="https://portal.telnyx.com/" target="_blank" rel="noopener noreferrer" className="text-ih-primary hover:underline">Telnyx Mission Control Portal</a>.
                Outbound SMS plus inbound STOP/HELP parity are both fully operational once the public key is set.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <SecretField name="TELNYX_API_KEY" label="Telnyx API Key"
                  value={secrets.TELNYX_API_KEY} error={secretFieldError("TELNYX_API_KEY")}
                  hint="Telnyx Mission Control → API Keys. Keep this secret." />
                <SecretField name="TELNYX_FROM_NUMBER" label="Telnyx From Number"
                  value={secrets.TELNYX_FROM_NUMBER} error={secretFieldError("TELNYX_FROM_NUMBER")}
                  hint="Your Telnyx sending number in E.164, e.g. +15551234567" />
                <SecretField name="TELNYX_PUBLIC_KEY" label="Telnyx Public Key"
                  value={secrets.TELNYX_PUBLIC_KEY} error={secretFieldError("TELNYX_PUBLIC_KEY")}
                  hint="Telnyx Mission Control → your Messaging Profile → Public Key. Used to verify inbound STOP/HELP webhooks." />
              </div>
            </>
          )}

          {secretFormError("save-sms-secrets") && (
            <p className="text-[12px] text-ih-bad-fg">{secretFormError("save-sms-secrets")}</p>
          )}
          <div className="flex justify-end pt-3 border-t border-ih-border">
            <button type="submit" disabled={savingSmsSecrets}
              className="h-8 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 transition-colors disabled:opacity-60">
              {savingSmsSecrets ? "Saving…" : `Save ${provider === "twilio" ? "Twilio" : "Telnyx"} credentials`}
            </button>
          </div>
        </Form>

        {/* Inbound webhook URL (own number / standalone only) */}
        {showInboundUrl && (
          <div className="pt-4 border-t border-ih-border space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3">Inbound webhook URL</p>
            <div className="flex items-center gap-2">
              <input
                type="text" readOnly value={inboundUrl || "Save your company first to see this URL"}
                className="flex-1 h-8 px-2 rounded-md border border-ih-border bg-ih-bg-muted text-[11px] font-mono text-ih-fg-3 outline-none"
              />
              <button type="button" disabled={!inboundUrl}
                onClick={() => { if (inboundUrl) void navigator.clipboard.writeText(inboundUrl); }}
                className="h-8 px-3 rounded-md bg-ih-primary text-white font-bold text-[12px] hover:bg-ih-primary-600 transition-colors shrink-0 disabled:opacity-60">
                Copy
              </button>
            </div>
            <p className="text-[11px] text-ih-fg-4">
              {provider === "telnyx"
                ? "Paste this into your Telnyx number’s inbound webhook so STOP/HELP replies sync. Set your Public Key above so we can verify these webhooks."
                : "Paste this into your Twilio number’s Messaging webhook so STOP/START replies sync."}
            </p>
          </div>
        )}

        {/* Send test SMS */}
        <smsTestFetcher.Form method="post" className="flex flex-wrap items-end gap-3 pt-4 border-t border-ih-border">
          <input type="hidden" name="intent" value="test-sms" />
          <div className="flex-1 min-w-[200px]">
            <label htmlFor="sms-test-to" className="block text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3 mb-1">Send test SMS</label>
            <input
              type="tel" name="to" id="sms-test-to" placeholder="+15551234567"
              className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
            />
          </div>
          <button type="submit" disabled={smsTestFetcher.state !== "idle"}
            className="h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[12px] font-bold text-ih-fg-2 hover:bg-ih-bg-muted transition-colors disabled:opacity-60">
            {smsTestFetcher.state !== "idle" ? "Sending…" : "Send test"}
          </button>
          {smsTestFetcher.data && "intent" in smsTestFetcher.data && smsTestFetcher.data.intent === "test-sms" && "ok" in smsTestFetcher.data && (
            smsTestFetcher.data.ok
              ? <span className="text-[12px] text-ih-ok-fg">Test message sent.</span>
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
