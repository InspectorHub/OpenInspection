import { Link, useLoaderData, useActionData, Form } from "react-router";
import { useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod/v4";
import type { Route } from "./+types/settings-communication";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { SecretField } from "~/components/SecretField";
import { communicationEmailSchema } from "~/lib/forms/settings-config.schema";

export function meta() {
  return [{ title: "Communication - Settings - OpenInspection" }];
}

interface CommConfig {
  senderEmail: string | null;
  replyTo: string | null;
  resendConfigured: boolean;
}

interface EmailTemplate {
  id: string;
  name: string;
  trigger: string;
  active: boolean;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  const api = createApi(context, { token });

  // Fetch communication config + secrets in parallel
  const [commRes, secretsRes] = await Promise.all([
    api.admin.communication.$get().catch(() => null),
    api.secrets.secrets.$get().catch(() => null),
  ]);

  const commBody = commRes?.ok ? ((await commRes.json()) as Record<string, unknown>) : {};
  const d = (commBody.data ?? {}) as Record<string, unknown>;

  const secretsBody = secretsRes?.ok ? ((await secretsRes.json()) as Record<string, unknown>) : {};
  const secrets = (secretsBody.data ?? {}) as Record<string, string>;

  return {
    config: {
      senderEmail: (d?.senderEmail as string) || null,
      replyTo: (d?.replyTo as string) || null,
      resendConfigured: Boolean(d?.resendConfigured),
    } as CommConfig,
    templates: (Array.isArray(d?.templates) ? d.templates : []) as EmailTemplate[],
    icsUrl: (d?.icsUrl as string) || null,
    googleCalendarConnected: Boolean(d?.googleCalendarConnected),
    secrets: {
      RESEND_API_KEY: secrets.RESEND_API_KEY || "",
      SENDER_EMAIL: secrets.SENDER_EMAIL || "",
      GOOGLE_CLIENT_ID: secrets.GOOGLE_CLIENT_ID || "",
      GOOGLE_CLIENT_SECRET: secrets.GOOGLE_CLIENT_SECRET || "",
    },
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const token = await requireToken(context, request);
  const form = await request.formData();
  const intent = form.get("intent");
  const api = createApi(context, { token });

  if (intent === "save-email") {
    const submission = parseWithZod(form, { schema: communicationEmailSchema });
    if (submission.status !== "success") {
      return submission.reply();
    }
    const { senderEmail, replyTo } = submission.value;
    const res = await api.admin.communication.$patch({
      json: {
        senderEmail: senderEmail || null,
        replyTo: replyTo || null,
      },
    });
    if (!res.ok) {
      return { ok: false, error: "Failed to save email settings." };
    }
    return { ok: true };
  }

  if (intent === "save-email-secrets") {
    const body: Record<string, string> = {};
    const resendKey = form.get("RESEND_API_KEY");
    const senderEmail = form.get("SENDER_EMAIL");
    if (resendKey && typeof resendKey === "string" && resendKey.trim()) body.RESEND_API_KEY = resendKey;
    if (senderEmail && typeof senderEmail === "string" && senderEmail.trim()) body.SENDER_EMAIL = senderEmail;

    if (Object.keys(body).length > 0) {
      const res = await api.secrets.secrets.$put({ json: body });
      if (!res.ok) {
        return { ok: false, error: "Failed to save email secrets." };
      }
    }
    return { ok: true };
  }

  if (intent === "save-calendar-secrets") {
    const body: Record<string, string> = {};
    const clientId = form.get("GOOGLE_CLIENT_ID");
    const clientSecret = form.get("GOOGLE_CLIENT_SECRET");
    if (clientId && typeof clientId === "string" && clientId.trim()) body.GOOGLE_CLIENT_ID = clientId;
    if (clientSecret && typeof clientSecret === "string" && clientSecret.trim()) body.GOOGLE_CLIENT_SECRET = clientSecret;

    if (Object.keys(body).length > 0) {
      const res = await api.secrets.secrets.$put({ json: body });
      if (!res.ok) {
        return { ok: false, error: "Failed to save calendar secrets." };
      }
    }
    return { ok: true };
  }

  return { ok: true };
}

export default function SettingsCommunication() {
  const { config, templates, icsUrl, googleCalendarConnected, secrets } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  // Only the `save-email` intent returns a Conform SubmissionResult; the
  // secret-paste intents return `{ ok }`. Feed Conform its own result only.
  const emailResult =
    actionData && !("ok" in actionData) ? actionData : undefined;
  const [emailForm, emailFields] = useForm({
    lastResult: emailResult,
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: communicationEmailSchema });
    },
    shouldValidate: "onBlur",
    shouldRevalidate: "onInput",
  });

  return (
    <div className="space-y-[18px]">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-[13px] text-ih-fg-3">
        <Link to="/settings" className="hover:text-ih-primary transition-colors">Settings</Link>
        <span>&rsaquo;</span>
        <span className="text-ih-fg-1">Communication</span>
      </div>

      <h2 className="text-[19px] font-bold text-ih-fg-1">Communication</h2>
      <p className="text-[13px] text-ih-fg-3">
        Configure email delivery, templates, and calendar sync.
      </p>

      {/* Flash */}
      {actionData && "ok" in actionData && !actionData.ok && actionData.error && (
        <div className="px-4 py-2.5 rounded-md bg-ih-bad-bg border border-ih-bad text-[13px] text-ih-bad-fg font-medium">
          {actionData.error}
        </div>
      )}

      {/* Email delivery config */}
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor={emailFields.senderEmail.id} className="block text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3 mb-1">Sender email</label>
              <input
                type="email"
                name={emailFields.senderEmail.name}
                id={emailFields.senderEmail.id}
                defaultValue={config.senderEmail || ""}
                placeholder="reports@yourdomain.com"
                aria-invalid={emailFields.senderEmail.errors ? true : undefined}
                className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
              />
              {emailFields.senderEmail.errors ? (
                <p className="mt-1 text-xs text-ih-bad-fg">{emailFields.senderEmail.errors[0]}</p>
              ) : (
                <p className="text-[11px] text-ih-fg-4 mt-1">Used as the "From" address. Domain must be verified in Resend.</p>
              )}
            </div>
            <div>
              <label htmlFor={emailFields.replyTo.id} className="block text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3 mb-1">Reply-to</label>
              <input
                type="email"
                name={emailFields.replyTo.name}
                id={emailFields.replyTo.id}
                defaultValue={config.replyTo || ""}
                placeholder="hello@yourdomain.com"
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

      {/* Email API keys */}
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
              hint="Email delivery for reports, confirmations, and password resets. Get your key at resend.com → API Keys"
            />
            <SecretField
              name="SENDER_EMAIL"
              label="Sender email (secret)"
              value={secrets.SENDER_EMAIL}
              type="text"
              hint="Verified sender address (e.g. reports@yourdomain.com). Must be verified in your Resend account"
            />
          </div>
          <div className="flex justify-end pt-3 border-t border-ih-border">
            <button type="submit" className="h-8 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 transition-colors">
              Save API keys
            </button>
          </div>
        </Form>
      </section>

      {/* Email templates */}
      <section className="bg-ih-bg-card border border-ih-border rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-ih-border">
          <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">Email templates</h3>
        </div>
        {templates.length === 0 ? (
          <div className="py-8 text-center text-[13px] text-ih-fg-3">
            No email templates configured. Default system emails are used.
          </div>
        ) : (
          <div className="divide-y divide-ih-border">
            {templates.map((tpl) => (
              <div key={tpl.id} className="flex items-center justify-between px-5 py-3 hover:bg-ih-bg-muted transition-colors">
                <div>
                  <p className="text-[13px] font-medium text-ih-fg-1">{tpl.name}</p>
                  <p className="text-[11px] text-ih-fg-3 mt-0.5">Trigger: {tpl.trigger}</p>
                </div>
                <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ${
 tpl.active
 ? "bg-ih-ok-bg text-ih-ok-fg"
 : "bg-ih-bg-muted text-ih-fg-3"
 }`}>
                  {tpl.active ? "Active" : "Disabled"}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Google Calendar OAuth secrets */}
      <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-4">
        <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">Google OAuth credentials</h3>
        <p className="text-[13px] text-ih-fg-3">
          Required for Google Calendar two-way sync. Create credentials at{" "}
          <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" className="text-ih-primary hover:underline">Google Cloud Console</a>.
        </p>
        <Form method="post" className="space-y-4">
          <input type="hidden" name="intent" value="save-calendar-secrets" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <SecretField
              name="GOOGLE_CLIENT_ID"
              label="Google Client ID"
              value={secrets.GOOGLE_CLIENT_ID}
              hint="Enables Google Calendar sync. Create at console.cloud.google.com → APIs → OAuth 2.0"
            />
            <SecretField
              name="GOOGLE_CLIENT_SECRET"
              label="Google Client Secret"
              value={secrets.GOOGLE_CLIENT_SECRET}
              hint="Paired with Client ID above. Found in the same OAuth 2.0 credentials page"
            />
          </div>
          <div className="flex justify-end pt-3 border-t border-ih-border">
            <button type="submit" className="h-8 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 transition-colors">
              Save credentials
            </button>
          </div>
        </Form>
      </section>

      {/* Calendar sync */}
      <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-4">
        <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">Calendar sync</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Google Calendar */}
          <div className="p-4 border border-ih-border rounded-lg">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 rounded-lg bg-ih-primary-tint flex items-center justify-center">
                <CalendarIcon className="w-4 h-4 text-ih-primary" />
              </div>
              <div>
                <p className="text-[13px] font-bold text-ih-fg-1">Google Calendar</p>
                <p className="text-[11px] text-ih-fg-3">Two-way sync via OAuth</p>
              </div>
            </div>
            {googleCalendarConnected ? (
              <span className="text-[11px] font-bold text-ih-ok-fg">Connected</span>
            ) : (
              <button className="h-8 px-3 rounded-md border border-ih-border text-[13px] font-medium text-ih-fg-2 hover:bg-ih-bg-muted transition-colors">
                Connect Google Calendar
              </button>
            )}
          </div>

          {/* Apple Calendar (ICS) */}
          <div className="p-4 border border-ih-border rounded-lg">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 rounded-lg bg-ih-bg-muted flex items-center justify-center">
                <CalendarIcon className="w-4 h-4 text-ih-fg-3" />
              </div>
              <div>
                <p className="text-[13px] font-bold text-ih-fg-1">Apple Calendar</p>
                <p className="text-[11px] text-ih-fg-3">Read-only ICS feed</p>
              </div>
            </div>
            {icsUrl ? (
              <div className="flex items-center gap-2">
                <input
                  type="text" readOnly value={icsUrl}
                  className="flex-1 h-8 px-2 rounded-md border border-ih-border bg-ih-bg-muted text-[11px] font-mono text-ih-fg-3 outline-none"
                />
                <button
                  onClick={() => { void navigator.clipboard.writeText(icsUrl); }}
                  className="h-8 px-3 rounded-md bg-ih-primary text-white font-bold text-[12px] hover:bg-ih-primary-600 transition-colors shrink-0"
                >
                  Copy
                </button>
              </div>
            ) : (
              <p className="text-[11px] text-ih-fg-3">ICS feed URL will appear once calendar sync is configured.</p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

/* Inline SVG icon */
function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  );
}
