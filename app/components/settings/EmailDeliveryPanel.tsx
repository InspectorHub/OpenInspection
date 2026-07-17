import { Link, Form } from "react-router";
import type { useForm } from "@conform-to/react";
import { m } from "~/paraglide/messages";

interface CommConfig {
  senderEmail: string | null;
  replyTo: string | null;
  resendConfigured: boolean;
  emailMode: "platform" | "own";
  senderDisplayName: string | null;
  companyName: string | null;
  pointOfContact: "inspector" | "company";
}

// Mirrors the all-optional shape Conform infers in the route's `useForm` call
// (no explicit generic — inferred from the schema's parse result).
type EmailFormShape = {
  senderEmail?: string | undefined;
  replyTo?: string | undefined;
  emailMode?: "platform" | "own" | undefined;
  senderDisplayName?: string | undefined;
  pointOfContact?: "inspector" | "company" | undefined;
};

type EmailForm = ReturnType<typeof useForm<EmailFormShape>>[0];
type EmailFields = ReturnType<typeof useForm<EmailFormShape>>[1];

type EmailByoProvider = "resend" | "sendgrid" | "postmark" | "mailgun";

/**
 * Settings → Communication: "Email delivery" panel. Presentational — the route
 * owns the Conform form, mode/override/PoC state, and the save action. Self-host
 * gating (`isSaas`) is threaded verbatim from the route.
 *
 * The "own" mode is provider-agnostic: the actual provider (Resend / SendGrid /
 * Postmark / Mailgun) is chosen in the Email API keys panel below. This panel's
 * own-mode copy + guardrails reflect `emailByoProvider` so they stay accurate
 * whichever provider the tenant picked.
 */
export function EmailDeliveryPanel({
  config,
  isSaas,
  emailByoProvider,
  ownProviderConfigured,
  mode,
  setMode,
  overrideName,
  setOverrideName,
  poc,
  setPoc,
  emailForm,
  emailFields,
  secretFormError,
}: {
  config: CommConfig;
  isSaas: boolean;
  emailByoProvider: EmailByoProvider;
  ownProviderConfigured: boolean;
  mode: "platform" | "own";
  setMode: (m: "platform" | "own") => void;
  overrideName: boolean;
  setOverrideName: (v: boolean) => void;
  poc: "inspector" | "company";
  setPoc: (p: "inspector" | "company") => void;
  emailForm: EmailForm;
  emailFields: EmailFields;
  secretFormError: (intent: string) => string | null;
}) {
  const EMAIL_PROVIDER_LABELS: Record<EmailByoProvider, string> = {
    resend: m.settings_email_provider_resend(),
    sendgrid: m.settings_email_provider_sendgrid(),
    postmark: m.settings_email_provider_postmark(),
    mailgun: m.settings_email_provider_mailgun(),
  };
  const providerLabel = EMAIL_PROVIDER_LABELS[emailByoProvider];
  return (
      <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-4">
        <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">{m.settings_emaildelivery_heading()}</h3>
        <Form
          method="post"
          id={emailForm.id}
          onSubmit={emailForm.onSubmit}
          noValidate
          className="space-y-4"
        >
          <input type="hidden" name="intent" value="save-email" />

          {/* Save-email server error banner (e.g. reply-to required) */}
          {secretFormError("save-email") && (
            <div className="px-4 py-2.5 rounded-md bg-ih-bad-bg border border-ih-bad text-[13px] text-ih-bad-fg font-medium">
              {secretFormError("save-email")}
            </div>
          )}

          {/* Guardrail banners */}
          {config.emailMode === "own" && (!config.senderEmail || !ownProviderConfigured) ? (
            <div className="px-4 py-2.5 rounded-md bg-ih-bad-bg border border-ih-bad text-[13px] text-ih-bad-fg font-medium">
              {m.settings_emaildelivery_own_missing({ provider: providerLabel })}
            </div>
          ) : null}
          {config.emailMode === "platform" && !config.resendConfigured ? (
            <div className="px-4 py-2.5 rounded-md bg-ih-bad-bg border border-ih-bad text-[13px] text-ih-bad-fg font-medium">
              {m.settings_emaildelivery_platform_missing()}
            </div>
          ) : null}
          {config.pointOfContact === "inspector" ? (
            <div className="px-4 py-2.5 rounded-md bg-ih-bg-muted border border-ih-border text-[12px] text-ih-fg-3">
              {m.settings_emaildelivery_inspector_note()}
            </div>
          ) : null}

          {/* Mode switch — SaaS only. Self-host has no platform mailbox, so the
              mode is forced to `own` (hidden input below) and the toggle hides. */}
          {isSaas ? (
            <>
              <div className="inline-flex rounded-md border border-ih-border overflow-hidden">
                {(["platform", "own"] as const).map((optMode) => (
                  <label key={optMode} className={`px-3 h-8 flex items-center text-[12px] font-bold cursor-pointer ${mode === optMode ? "bg-ih-primary text-white" : "bg-ih-bg-card text-ih-fg-2"}`}>
                    <input
                      type="radio" name={emailFields.emailMode.name} value={optMode}
                      defaultChecked={config.emailMode === optMode}
                      onChange={() => setMode(optMode)}
                      className="sr-only"
                    />
                    {optMode === "platform" ? m.settings_emaildelivery_mode_platform() : m.settings_emaildelivery_mode_own()}
                  </label>
                ))}
              </div>
              <p className="text-[11px] text-ih-fg-4">
                {mode === "platform"
                  ? m.settings_emaildelivery_mode_platform_desc()
                  : m.settings_emaildelivery_mode_own_desc()}
              </p>
            </>
          ) : (
            <>
              {/* Force `own` so the save action never writes the schema's
                  default `platform` back into self-host config. */}
              <input type="hidden" name={emailFields.emailMode.name} value="own" />
              <p className="text-[13px] text-ih-fg-3 bg-ih-bg-muted border border-ih-border rounded-md p-3">
                {m.settings_emaildelivery_selfhost_note()}
              </p>
            </>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {mode === "own" && (
              <div>
                <label htmlFor={emailFields.senderEmail.id} className="block text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3 mb-1">{m.settings_emaildelivery_sender_email_label()}</label>
                <input
                  type="email" name={emailFields.senderEmail.name} id={emailFields.senderEmail.id}
                  defaultValue={config.senderEmail || ""} placeholder={m.settings_emaildelivery_sender_email_placeholder()}
                  aria-invalid={emailFields.senderEmail.errors ? true : undefined}
                  className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
                />
                {emailFields.senderEmail.errors ? (
                  <p className="mt-1 text-xs text-ih-bad-fg">{emailFields.senderEmail.errors[0]}</p>
                ) : (
                  <p className="text-[11px] text-ih-fg-4 mt-1">{m.settings_emaildelivery_sender_verified({ provider: providerLabel })}</p>
                )}
              </div>
            )}
            <div className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3">{m.settings_emaildelivery_from_name_label()}</p>
              <p className="text-[13px] text-ih-fg-2">
                <strong>
                  {config.companyName || config.senderDisplayName || (
                    <Link to="/settings/workspace" className="text-ih-primary hover:underline">{m.settings_emaildelivery_set_company_link()}</Link>
                  )}
                </strong>
                {config.companyName && (
                  <span className="text-[11px] text-ih-fg-4 ml-2">{m.settings_emaildelivery_from_workspace()}</span>
                )}
              </p>
              <label className="flex items-center gap-2 text-[12px] text-ih-fg-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={overrideName}
                  onChange={(e) => setOverrideName(e.currentTarget.checked)}
                  className="h-4 w-4 border-ih-border"
                />
                {m.settings_emaildelivery_override_name()}
              </label>
              {overrideName ? (
                <input
                  type="text" name={emailFields.senderDisplayName.name} id={emailFields.senderDisplayName.id}
                  defaultValue={config.senderDisplayName || ""} placeholder={m.settings_emaildelivery_display_name_placeholder()}
                  className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
                />
              ) : (
                <input type="hidden" name={emailFields.senderDisplayName.name} value="" />
              )}
            </div>
            <div>
              <label htmlFor={emailFields.replyTo.id} className="block text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3 mb-1">
                {m.settings_emaildelivery_replyto_label()} <span className="normal-case font-normal text-ih-bad-fg">{m.settings_emaildelivery_replyto_required()}</span>
              </label>
              {config.emailMode === "own" && config.senderEmail ? (
                <label className="flex items-center gap-2 text-[12px] text-ih-fg-3 mb-1">
                  <input
                    type="checkbox"
                    onChange={(e) => {
                      const replyEl = document.querySelector<HTMLInputElement>(`input[name="${emailFields.replyTo.name}"]`);
                      if (replyEl && e.currentTarget.checked) replyEl.value = config.senderEmail ?? "";
                    }}
                  />
                  {m.settings_emaildelivery_same_as_sender()}
                </label>
              ) : null}
              <input
                type="email" name={emailFields.replyTo.name} id={emailFields.replyTo.id}
                defaultValue={config.replyTo || ""} placeholder={m.settings_emaildelivery_replyto_placeholder()}
                aria-invalid={emailFields.replyTo.errors ? true : undefined}
                className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
              />
              {emailFields.replyTo.errors ? (
                <p className="mt-1 text-xs text-ih-bad-fg">{emailFields.replyTo.errors[0]}</p>
              ) : (
                <p className="text-[11px] text-ih-fg-4 mt-1">{m.settings_emaildelivery_replies_note()}</p>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3">{m.settings_emaildelivery_poc_label()}</p>
            {(["company", "inspector"] as const).map((p) => (
              <label key={p} className="flex items-center gap-2 text-[13px] text-ih-fg-2 cursor-pointer">
                <input
                  type="radio" name={emailFields.pointOfContact.name} value={p}
                  defaultChecked={config.pointOfContact === p}
                  onChange={() => setPoc(p)}
                  className="h-4 w-4 border-ih-border"
                />
                {p === "company" ? m.settings_emaildelivery_poc_company() : m.settings_emaildelivery_poc_inspector()}
              </label>
            ))}
            <p className="text-[11px] text-ih-fg-4 pt-1">
              {m.settings_emaildelivery_send_as()}{" "}
              <strong>
                {poc === "company"
                  ? (overrideName && config.senderDisplayName ? config.senderDisplayName : (config.companyName || config.senderDisplayName || m.settings_emaildelivery_your_company()))
                  : m.settings_emaildelivery_the_inspector()}
              </strong>
              {poc === "inspector"
                ? m.settings_emaildelivery_replies_to_inspector()
                : config.replyTo
                  ? m.settings_emaildelivery_replies_to_address({ replyTo: config.replyTo })
                  : ""}
            </p>
          </div>

          {emailForm.errors && (
            <div className="px-3 py-2 rounded-md bg-ih-bad-bg border border-ih-bad text-[13px] text-ih-bad-fg">
              {emailForm.errors[0]}
            </div>
          )}
          <div className="flex items-center justify-between pt-3 border-t border-ih-border">
            {(() => {
              // Status reflects the live mode selection: own → the chosen
              // provider's creds; platform → the platform Resend key.
              const activeConfigured = mode === "own" ? ownProviderConfigured : config.resendConfigured;
              const activeLabel = mode === "own" ? m.settings_emaildelivery_provider_credentials({ provider: providerLabel }) : m.settings_emaildelivery_mode_platform();
              return (
                <span className={`text-[11px] font-bold ${activeConfigured ? "text-ih-ok-fg" : "text-ih-watch-fg"}`}>
                  {activeConfigured ? m.settings_emaildelivery_label_configured({ label: activeLabel }) : m.settings_emaildelivery_label_not_set({ label: activeLabel })}
                </span>
              );
            })()}
            <button type="submit" className="h-8 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 transition-colors">
              {m.common_save()}
            </button>
          </div>
        </Form>
      </section>
  );
}
