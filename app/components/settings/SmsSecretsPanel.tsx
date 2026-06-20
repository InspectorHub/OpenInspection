import { Form } from "react-router";
import type { useFetcher } from "react-router";
import { SecretField } from "~/components/SecretField";
import type { action } from "~/routes/settings-communication";

type SmsTestFetcher = ReturnType<typeof useFetcher<typeof action>>;

/**
 * Settings → Communication: Twilio credentials + inbound webhook URL + test-SMS
 * controls. Presentational sibling of SmsDeliveryPanel (rendered inside the same
 * SMS <section>); the route owns secrets, pending state, fetcher, and the
 * resolved inbound URL.
 */
export function SmsSecretsPanel({
  secrets,
  secretFieldError,
  secretFormError,
  savingSmsSecrets,
  showInboundUrl,
  inboundUrl,
  smsTestFetcher,
}: {
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
    <>
        {/* Twilio credentials */}
        <Form method="post" className="space-y-4 pt-4 border-t border-ih-border">
          <input type="hidden" name="intent" value="save-sms-secrets" />
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
          {secretFormError("save-sms-secrets") && (
            <p className="text-[12px] text-ih-bad-fg">{secretFormError("save-sms-secrets")}</p>
          )}
          <div className="flex justify-end pt-3 border-t border-ih-border">
            <button type="submit" disabled={savingSmsSecrets}
              className="h-8 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 transition-colors disabled:opacity-60">
              {savingSmsSecrets ? "Saving…" : "Save Twilio credentials"}
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
            <p className="text-[11px] text-ih-fg-4">Paste this into your Twilio number&rsquo;s Messaging webhook so STOP/START replies sync.</p>
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
    </>
  );
}
