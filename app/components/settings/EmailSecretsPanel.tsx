import { useState } from "react";
import { Form } from "react-router";
import type { useFetcher } from "react-router";
import { SecretField } from "~/components/SecretField";
import { TestConnectionButton } from "~/components/settings/TestConnectionButton";
import type { action } from "~/routes/settings-communication";

type ActionFetcher = ReturnType<typeof useFetcher<typeof action>>;

type EmailByoProvider = "resend" | "sendgrid" | "postmark" | "mailgun";

const PROVIDER_LABELS: Record<EmailByoProvider, string> = {
  resend: "Resend",
  sendgrid: "SendGrid",
  postmark: "Postmark",
  mailgun: "Mailgun",
};

/**
 * Settings → Communication: "Email API keys" panel. Presentational — the route
 * owns the secret values, pending state, fetcher, and error mappers, threading
 * them in as props.
 *
 * A provider selector (Resend / SendGrid / Postmark / Mailgun) lets tenants pick
 * their email delivery adapter. The choice is submitted as a hidden
 * `email_byo_provider` field and the route's `save-email-secrets` action
 * persists it to the tenant-config endpoint alongside the credentials.
 *
 * The "Test connection" button probes the Resend key and is only shown when
 * the Resend provider is selected. For sendgrid / postmark / mailgun a generic
 * "Validate credentials" button is shown instead, posting validate-email-provider.
 */
export function EmailSecretsPanel({
  secrets,
  secretFieldError,
  secretFormError,
  savingEmailSecrets,
  resendTestFetcher,
  resendTest,
  emailValidateFetcher,
  initialProvider = "resend",
}: {
  secrets: {
    RESEND_API_KEY: string;
    SENDGRID_API_KEY: string;
    POSTMARK_SERVER_TOKEN: string;
    MAILGUN_API_KEY: string;
    MAILGUN_DOMAIN: string;
  };
  secretFieldError: (name: string) => string | undefined;
  secretFormError: (intent: string) => string | null;
  savingEmailSecrets: boolean;
  resendTestFetcher: ActionFetcher;
  resendTest: ActionFetcher["data"];
  emailValidateFetcher: ActionFetcher;
  initialProvider?: EmailByoProvider;
}) {
  const [provider, setProvider] = useState<EmailByoProvider>(initialProvider);

  return (
    <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-4">
      <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">Email API keys</h3>
      <p className="text-[13px] text-ih-fg-3">
        Without email configured, password resets and booking confirmations will not be sent.
        Choose your email provider and enter its API credentials.
      </p>

      <Form method="post" className="space-y-4">
        <input type="hidden" name="intent" value="save-email-secrets" />
        {/* Hidden field carries the selected provider so the action can read it */}
        <input type="hidden" name="email_byo_provider" value={provider} />

        {/* Provider choice */}
        <div className="space-y-1.5">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3">Email provider</p>
          <div className="flex gap-2">
            {(["resend", "sendgrid", "postmark", "mailgun"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setProvider(p)}
                className={`flex-1 h-9 rounded-md border text-[13px] font-bold transition-colors ${
                  provider === p
                    ? "border-ih-primary bg-ih-primary/5 text-ih-primary"
                    : "border-ih-border bg-ih-bg-card text-ih-fg-2 hover:border-ih-primary/40"
                }`}
              >
                {PROVIDER_LABELS[p]}
              </button>
            ))}
          </div>
        </div>

        {/* Resend credential fields */}
        {provider === "resend" && (
          <>
            <p className="text-[13px] text-ih-fg-3">
              Get a key at{" "}
              <a href="https://resend.com" target="_blank" rel="noopener noreferrer" className="text-ih-primary hover:underline">resend.com</a>.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <SecretField
                name="RESEND_API_KEY"
                label="Resend API key"
                value={secrets.RESEND_API_KEY}
                error={secretFieldError("RESEND_API_KEY")}
                hint="Email delivery for reports, confirmations, and password resets. Get your key at resend.com → API Keys"
              />
            </div>
          </>
        )}

        {/* SendGrid credential fields */}
        {provider === "sendgrid" && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <SecretField
                name="SENDGRID_API_KEY"
                label="SendGrid API key"
                value={secrets.SENDGRID_API_KEY}
                error={secretFieldError("SENDGRID_API_KEY")}
                hint="Starts with SG. — SendGrid → Settings → API Keys"
              />
            </div>
          </>
        )}

        {/* Postmark credential fields */}
        {provider === "postmark" && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <SecretField
                name="POSTMARK_SERVER_TOKEN"
                label="Postmark Server Token"
                value={secrets.POSTMARK_SERVER_TOKEN}
                error={secretFieldError("POSTMARK_SERVER_TOKEN")}
                hint="Postmark → Servers → API Tokens"
              />
            </div>
          </>
        )}

        {/* Mailgun credential fields */}
        {provider === "mailgun" && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <SecretField
                name="MAILGUN_API_KEY"
                label="Mailgun API key"
                value={secrets.MAILGUN_API_KEY}
                error={secretFieldError("MAILGUN_API_KEY")}
                hint="Mailgun → Settings → API Keys"
              />
              <SecretField
                name="MAILGUN_DOMAIN"
                label="Mailgun sending domain"
                value={secrets.MAILGUN_DOMAIN}
                error={secretFieldError("MAILGUN_DOMAIN")}
                hint="Your sending domain, e.g. mg.yourdomain.com"
              />
            </div>
          </>
        )}

        {secretFormError("save-email-secrets") && (
          <p className="text-[12px] text-ih-bad-fg">{secretFormError("save-email-secrets")}</p>
        )}
        <div className="flex justify-end pt-3 border-t border-ih-border">
          <button type="submit" disabled={savingEmailSecrets}
            className="h-8 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed">
            {savingEmailSecrets ? "Saving…" : `Save ${PROVIDER_LABELS[provider]} key(s)`}
          </button>
        </div>
      </Form>

      {/* Test connection — probes the STORED Resend key; shown for Resend only */}
      {provider === "resend" && (
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
      )}

      {/* Validate credentials — generic probe for sendgrid / postmark / mailgun.
          The hidden `provider` input is a child of TestConnectionButton so it
          lands inside the fetcher.Form the component renders. */}
      {provider !== "resend" && (
        <TestConnectionButton
          fetcher={emailValidateFetcher}
          intent="validate-email-provider"
          idleLabel="Validate credentials"
          busyLabel="Validating…"
        >
          {/* This input is inside fetcher.Form (TestConnectionButton wraps children in the form) */}
          <input type="hidden" name="provider" value={provider} />
          {emailValidateFetcher.data &&
            "intent" in emailValidateFetcher.data &&
            emailValidateFetcher.data.intent === "validate-email-provider" &&
            "ok" in emailValidateFetcher.data &&
            emailValidateFetcher.data.ok && (
              <span className="text-[12px] text-ih-ok-fg">Credentials verified.</span>
            )}
          {emailValidateFetcher.data &&
            "intent" in emailValidateFetcher.data &&
            emailValidateFetcher.data.intent === "validate-email-provider" &&
            "ok" in emailValidateFetcher.data &&
            !emailValidateFetcher.data.ok && (
              <span className="text-[12px] text-ih-bad-fg">{emailValidateFetcher.data.error}</span>
            )}
        </TestConnectionButton>
      )}
    </section>
  );
}
