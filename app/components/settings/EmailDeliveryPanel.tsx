import { Link, Form } from "react-router";
import type { useForm } from "@conform-to/react";

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

/**
 * Settings → Communication: "Email delivery" panel. Presentational — the route
 * owns the Conform form, mode/override/PoC state, and the save action. Self-host
 * gating (`isSaas`) is threaded verbatim from the route.
 */
export function EmailDeliveryPanel({
  config,
  isSaas,
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
  return (
      <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-4">
        <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">Email delivery</h3>
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
          {config.emailMode === "own" && (!config.senderEmail || !config.resendConfigured) ? (
            <div className="px-4 py-2.5 rounded-md bg-ih-bad-bg border border-ih-bad text-[13px] text-ih-bad-fg font-medium">
              Own domain selected but no sender address / Resend key — emails will fail to send.
            </div>
          ) : null}
          {config.emailMode === "platform" && !config.resendConfigured ? (
            <div className="px-4 py-2.5 rounded-md bg-ih-bad-bg border border-ih-bad text-[13px] text-ih-bad-fg font-medium">
              No platform email is configured (SENDER_EMAIL / Resend) — emails cannot be sent.
            </div>
          ) : null}
          {config.pointOfContact === "inspector" ? (
            <div className="px-4 py-2.5 rounded-md bg-ih-bg-muted border border-ih-border text-[12px] text-ih-fg-3">
              Emails use each inspector&rsquo;s name &amp; email; inspectors without a name fall back to the company.
            </div>
          ) : null}

          {/* Mode switch — SaaS only. Self-host has no platform mailbox, so the
              mode is forced to `own` (hidden input below) and the toggle hides. */}
          {isSaas ? (
            <>
              <div className="inline-flex rounded-md border border-ih-border overflow-hidden">
                {(["platform", "own"] as const).map((m) => (
                  <label key={m} className={`px-3 h-8 flex items-center text-[12px] font-bold cursor-pointer ${mode === m ? "bg-ih-primary text-white" : "bg-ih-bg-card text-ih-fg-2"}`}>
                    <input
                      type="radio" name={emailFields.emailMode.name} value={m}
                      defaultChecked={config.emailMode === m}
                      onChange={() => setMode(m)}
                      className="sr-only"
                    />
                    {m === "platform" ? "Platform email" : "My own Resend"}
                  </label>
                ))}
              </div>
              <p className="text-[11px] text-ih-fg-4">
                {mode === "platform"
                  ? "Send from the platform mailbox. You can set the display name and reply-to; the address is fixed."
                  : "Send from your own Resend account. Add your Resend API key below and a verified sender address."}
              </p>
            </>
          ) : (
            <>
              {/* Force `own` so the save action never writes the schema's
                  default `platform` back into self-host config. */}
              <input type="hidden" name={emailFields.emailMode.name} value="own" />
              <p className="text-[13px] text-ih-fg-3 bg-ih-bg-muted border border-ih-border rounded-md p-3">
                Self-hosted deployments send from your own Resend account. Add your Resend
                API key and a verified sender address below to enable email.
              </p>
            </>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {mode === "own" && (
              <div>
                <label htmlFor={emailFields.senderEmail.id} className="block text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3 mb-1">Sender email</label>
                <input
                  type="email" name={emailFields.senderEmail.name} id={emailFields.senderEmail.id}
                  defaultValue={config.senderEmail || ""} placeholder="reports@yourdomain.com"
                  aria-invalid={emailFields.senderEmail.errors ? true : undefined}
                  className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
                />
                {emailFields.senderEmail.errors ? (
                  <p className="mt-1 text-xs text-ih-bad-fg">{emailFields.senderEmail.errors[0]}</p>
                ) : (
                  <p className="text-[11px] text-ih-fg-4 mt-1">Must be a domain verified in your Resend account.</p>
                )}
              </div>
            )}
            <div className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3">From name</p>
              <p className="text-[13px] text-ih-fg-2">
                <strong>
                  {config.companyName || config.senderDisplayName || (
                    <Link to="/settings/workspace" className="text-ih-primary hover:underline">Set your company name in Settings &rsaquo; Workspace</Link>
                  )}
                </strong>
                {config.companyName && (
                  <span className="text-[11px] text-ih-fg-4 ml-2">(from Workspace settings)</span>
                )}
              </p>
              <label className="flex items-center gap-2 text-[12px] text-ih-fg-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={overrideName}
                  onChange={(e) => setOverrideName(e.currentTarget.checked)}
                  className="h-4 w-4 border-ih-border"
                />
                Use a different name for email From
              </label>
              {overrideName ? (
                <input
                  type="text" name={emailFields.senderDisplayName.name} id={emailFields.senderDisplayName.id}
                  defaultValue={config.senderDisplayName || ""} placeholder="Acme Inspections"
                  className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
                />
              ) : (
                <input type="hidden" name={emailFields.senderDisplayName.name} value="" />
              )}
            </div>
            <div>
              <label htmlFor={emailFields.replyTo.id} className="block text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3 mb-1">
                Reply-to <span className="normal-case font-normal text-ih-bad-fg">* required when Point of Contact is Company</span>
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
                  Same as sender email
                </label>
              ) : null}
              <input
                type="email" name={emailFields.replyTo.name} id={emailFields.replyTo.id}
                defaultValue={config.replyTo || ""} placeholder="hello@yourdomain.com"
                aria-invalid={emailFields.replyTo.errors ? true : undefined}
                className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
              />
              {emailFields.replyTo.errors ? (
                <p className="mt-1 text-xs text-ih-bad-fg">{emailFields.replyTo.errors[0]}</p>
              ) : (
                <p className="text-[11px] text-ih-fg-4 mt-1">Replies go to this address.</p>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3">Point of contact</p>
            {(["company", "inspector"] as const).map((p) => (
              <label key={p} className="flex items-center gap-2 text-[13px] text-ih-fg-2 cursor-pointer">
                <input
                  type="radio" name={emailFields.pointOfContact.name} value={p}
                  defaultChecked={config.pointOfContact === p}
                  onChange={() => setPoc(p)}
                  className="h-4 w-4 border-ih-border"
                />
                {p === "company" ? "Company (reply-to address required)" : "Sending inspector (replies go to that inspector)"}
              </label>
            ))}
            <p className="text-[11px] text-ih-fg-4 pt-1">
              Emails send as:{" "}
              <strong>
                {poc === "company"
                  ? (overrideName && config.senderDisplayName ? config.senderDisplayName : (config.companyName || config.senderDisplayName || "your company"))
                  : "the sending inspector"}
              </strong>
              {poc === "inspector"
                ? ", replies go to that inspector"
                : config.replyTo
                  ? `, replies go to ${config.replyTo}`
                  : ""}
            </p>
          </div>

          {emailForm.errors && (
            <div className="px-3 py-2 rounded-md bg-ih-bad-bg border border-ih-bad text-[13px] text-ih-bad-fg">
              {emailForm.errors[0]}
            </div>
          )}
          <div className="flex items-center justify-between pt-3 border-t border-ih-border">
            <span className={`text-[11px] font-bold ${config.resendConfigured ? "text-ih-ok-fg" : "text-ih-watch-fg"}`}>
              {config.resendConfigured ? "Resend API key configured" : "Resend API key not set"}
            </span>
            <button type="submit" className="h-8 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 transition-colors">
              Save
            </button>
          </div>
        </Form>
      </section>
  );
}
