import { useState } from "react";
import { Form } from "react-router";
import type { useFetcher } from "react-router";
import { SecretField } from "~/components/SecretField";
import { TestConnectionButton } from "~/components/settings/TestConnectionButton";
import { ConnectionTestStatus, type ConnectionTestResult } from "~/components/settings/ConnectionTestStatus";
import type { action } from "~/routes/settings-communication";
import { m } from "~/paraglide/messages";

type ActionFetcher = ReturnType<typeof useFetcher<typeof action>>;

type EmailByoProvider = "resend" | "sendgrid" | "postmark" | "mailgun";

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
/**
 * Per-provider label + hint for the inbound deliverability webhook secret
 * (WH-3). The hint points at where the user configures the receiver URL; the
 * URL itself is rendered separately from `webhookUrl` so it can carry the live
 * origin + tenant slug.
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
  webhookBaseUrl = "",
  tenantSlug = "",
  testResults = [],
}: {
  secrets: {
    RESEND_API_KEY: string;
    SENDGRID_API_KEY: string;
    POSTMARK_SERVER_TOKEN: string;
    MAILGUN_API_KEY: string;
    MAILGUN_DOMAIN: string;
    RESEND_WEBHOOK_SECRET: string;
    SENDGRID_WEBHOOK_PUBLIC_KEY: string;
    POSTMARK_WEBHOOK_TOKEN: string;
    MAILGUN_SIGNING_KEY: string;
  };
  secretFieldError: (name: string) => string | undefined;
  secretFormError: (intent: string) => string | null;
  savingEmailSecrets: boolean;
  resendTestFetcher: ActionFetcher;
  resendTest: ActionFetcher["data"];
  emailValidateFetcher: ActionFetcher;
  initialProvider?: EmailByoProvider;
  /** Origin used to build the deliverability webhook URL hint (e.g. https://app…). */
  webhookBaseUrl?: string;
  /** Tenant slug appended to the webhook URL path. */
  tenantSlug?: string;
  /** Persisted "Test connection" history (shared loader list, filtered to email). */
  testResults?: ConnectionTestResult[];
}) {
  const PROVIDER_LABELS: Record<EmailByoProvider, string> = {
    resend: m.settings_email_provider_resend(),
    sendgrid: m.settings_email_provider_sendgrid(),
    postmark: m.settings_email_provider_postmark(),
    mailgun: m.settings_email_provider_mailgun(),
  };
  const WEBHOOK_FIELDS: Record<EmailByoProvider, { name: string; label: string; hint: string }> = {
    resend: {
      name: "RESEND_WEBHOOK_SECRET",
      label: m.settings_emailsecrets_webhook_resend_label(),
      hint: m.settings_emailsecrets_webhook_resend_hint(),
    },
    sendgrid: {
      name: "SENDGRID_WEBHOOK_PUBLIC_KEY",
      label: m.settings_emailsecrets_webhook_sendgrid_label(),
      hint: m.settings_emailsecrets_webhook_sendgrid_hint(),
    },
    postmark: {
      name: "POSTMARK_WEBHOOK_TOKEN",
      label: m.settings_emailsecrets_webhook_postmark_label(),
      hint: m.settings_emailsecrets_webhook_postmark_hint(),
    },
    mailgun: {
      name: "MAILGUN_SIGNING_KEY",
      label: m.settings_emailsecrets_webhook_mailgun_label(),
      hint: m.settings_emailsecrets_webhook_mailgun_hint(),
    },
  };
  const [provider, setProvider] = useState<EmailByoProvider>(initialProvider);
  const webhookField = WEBHOOK_FIELDS[provider];
  const webhookUrl =
    webhookBaseUrl && tenantSlug
      ? `${webhookBaseUrl}/api/public/email/${provider}/${tenantSlug}`
      : "";

  return (
    <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-4">
      <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">{m.settings_emailsecrets_heading()}</h3>
      <p className="text-[13px] text-ih-fg-3">
        {m.settings_emailsecrets_desc()}
      </p>

      <Form method="post" className="space-y-4">
        <input type="hidden" name="intent" value="save-email-secrets" />
        {/* Hidden field carries the selected provider so the action can read it */}
        <input type="hidden" name="email_byo_provider" value={provider} />

        {/* Provider choice */}
        <div className="space-y-1.5">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3">{m.settings_emailsecrets_provider_label()}</p>
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
              {m.settings_emailsecrets_get_key_at()}{" "}
              <a href="https://resend.com" target="_blank" rel="noopener noreferrer" className="text-ih-primary hover:underline">resend.com</a>.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <SecretField
                name="RESEND_API_KEY"
                label={m.settings_emailsecrets_resend_key_label()}
                value={secrets.RESEND_API_KEY}
                error={secretFieldError("RESEND_API_KEY")}
                hint={m.settings_emailsecrets_resend_key_hint()}
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
                label={m.settings_emailsecrets_sendgrid_key_label()}
                value={secrets.SENDGRID_API_KEY}
                error={secretFieldError("SENDGRID_API_KEY")}
                hint={m.settings_emailsecrets_sendgrid_key_hint()}
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
                label={m.settings_emailsecrets_postmark_token_label()}
                value={secrets.POSTMARK_SERVER_TOKEN}
                error={secretFieldError("POSTMARK_SERVER_TOKEN")}
                hint={m.settings_emailsecrets_postmark_token_hint()}
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
                label={m.settings_emailsecrets_mailgun_key_label()}
                value={secrets.MAILGUN_API_KEY}
                error={secretFieldError("MAILGUN_API_KEY")}
                hint={m.settings_emailsecrets_mailgun_key_hint()}
              />
              <SecretField
                name="MAILGUN_DOMAIN"
                label={m.settings_emailsecrets_mailgun_domain_label()}
                value={secrets.MAILGUN_DOMAIN}
                error={secretFieldError("MAILGUN_DOMAIN")}
                hint={m.settings_emailsecrets_mailgun_domain_hint()}
              />
            </div>
          </>
        )}

        {/* Inbound deliverability webhook (WH-3) — verifies bounce/complaint
            callbacks for the selected provider, feeding the suppression list. */}
        <div className="space-y-3 pt-3 border-t border-ih-border">
          <div className="space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3">{m.settings_emailsecrets_deliverability_label()}</p>
            <p className="text-[12px] text-ih-fg-3">
              {m.settings_emailsecrets_deliverability_desc({ provider: PROVIDER_LABELS[provider] })}
            </p>
          </div>
          {webhookUrl ? (
            <div className="space-y-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3">{m.settings_emailsecrets_webhook_url_label()}</p>
              <code className="block w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-muted text-[12px] font-mono text-ih-fg-2 break-all">
                {webhookUrl}
              </code>
            </div>
          ) : null}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <SecretField
              name={webhookField.name}
              label={webhookField.label}
              value={secrets[webhookField.name as keyof typeof secrets]}
              error={secretFieldError(webhookField.name)}
              hint={webhookField.hint}
            />
          </div>
        </div>

        {secretFormError("save-email-secrets") && (
          <p className="text-[12px] text-ih-bad-fg">{secretFormError("save-email-secrets")}</p>
        )}
        <div className="flex justify-end pt-3 border-t border-ih-border">
          <button type="submit" disabled={savingEmailSecrets}
            className="h-8 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed">
            {savingEmailSecrets ? m.common_saving() : m.settings_emailsecrets_save({ provider: PROVIDER_LABELS[provider] })}
          </button>
        </div>
      </Form>

      {/* Test connection — probes the STORED Resend key; shown for Resend only */}
      {provider === "resend" && (
        <TestConnectionButton fetcher={resendTestFetcher} intent="test-resend">
          {resendTest && "intent" in resendTest && resendTest.intent === "test-resend" && resendTest.test && "domains" in resendTest.test && (
            <span className="text-[12px] text-ih-fg-2">
              {m.settings_emailsecrets_resend_connected({ count: resendTest.test.domains })}
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
          idleLabel={m.settings_emailsecrets_validate_idle()}
          busyLabel={m.settings_emailsecrets_validate_busy()}
        >
          {/* This input is inside fetcher.Form (TestConnectionButton wraps children in the form) */}
          <input type="hidden" name="provider" value={provider} />
          {emailValidateFetcher.data &&
            "intent" in emailValidateFetcher.data &&
            emailValidateFetcher.data.intent === "validate-email-provider" &&
            "ok" in emailValidateFetcher.data &&
            emailValidateFetcher.data.ok && (
              <span className="text-[12px] text-ih-ok-fg">{m.settings_emailsecrets_creds_verified()}</span>
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

      {/* Persisted last-tested status + recent history (survives reloads). */}
      <ConnectionTestStatus results={testResults} target="email" />
    </section>
  );
}
