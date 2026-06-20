import { Form } from "react-router";
import type { useFetcher } from "react-router";
import { SecretField } from "~/components/SecretField";
import { TestConnectionButton } from "~/components/settings/TestConnectionButton";
import type { action } from "~/routes/settings-communication";

type ResendTestFetcher = ReturnType<typeof useFetcher<typeof action>>;

/**
 * Settings → Communication: "Email API keys" panel. Presentational — the route
 * owns the secret values, pending state, fetcher, and error mappers, threading
 * them in as props.
 */
export function EmailSecretsPanel({
  secrets,
  secretFieldError,
  secretFormError,
  savingEmailSecrets,
  resendTestFetcher,
  resendTest,
}: {
  secrets: { RESEND_API_KEY: string };
  secretFieldError: (name: string) => string | undefined;
  secretFormError: (intent: string) => string | null;
  savingEmailSecrets: boolean;
  resendTestFetcher: ResendTestFetcher;
  resendTest: ResendTestFetcher["data"];
}) {
  return (
      <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-4">
        <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">Email API keys</h3>
        <p className="text-[13px] text-ih-fg-3">
          Without email configured, password resets and booking confirmations will not be sent.
          Get a key at{" "}
          <a href="https://resend.com" target="_blank" rel="noopener noreferrer" className="text-ih-primary hover:underline">resend.com</a>.
        </p>
        <Form method="post" className="space-y-4">
          <input type="hidden" name="intent" value="save-email-secrets" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <SecretField
              name="RESEND_API_KEY"
              label="Resend API key"
              value={secrets.RESEND_API_KEY}
              error={secretFieldError("RESEND_API_KEY")}
              hint="Email delivery for reports, confirmations, and password resets. Get your key at resend.com → API Keys"
            />
          </div>
          {secretFormError("save-email-secrets") && !secretFieldError("RESEND_API_KEY") && (
            <p className="text-[12px] text-ih-bad-fg">{secretFormError("save-email-secrets")}</p>
          )}
          <div className="flex justify-end pt-3 border-t border-ih-border">
            <button type="submit" disabled={savingEmailSecrets}
              className="h-8 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed">
              {savingEmailSecrets ? "Saving…" : "Save API keys"}
            </button>
          </div>
        </Form>

        {/* Test connection — probes the STORED Resend key, no re-entry needed */}
        <TestConnectionButton fetcher={resendTestFetcher} intent="test-resend">
          {resendTest && "intent" in resendTest && resendTest.intent === "test-resend" && resendTest.test && "domains" in resendTest.test && (
            <span className="text-[12px] text-ih-fg-2">
              Connected — {resendTest.test.domains} verified domain(s)
            </span>
          )}
          {resendTest && "intent" in resendTest && resendTest.intent === "test-resend" && "ok" in resendTest && !resendTest.ok && (
            <span className="text-[12px] text-ih-bad-fg">{resendTest.error}</span>
          )}
        </TestConnectionButton>
      </section>
  );
}
