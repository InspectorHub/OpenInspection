import { useState, useEffect } from "react";
import { Link, useLoaderData, useActionData, useNavigation, useFetcher, Form } from "react-router";
import { useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod/v4";
import type { Route } from "./+types/settings-communication";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { SecretField } from "~/components/SecretField";
import { communicationEmailSchema } from "~/lib/forms/settings-config.schema";
import { TemplateList } from "~/components/email-template/TemplateList";
import { useSessionContext } from "~/hooks/useSessionContext";

export function meta() {
  return [{ title: "Communication - Settings - OpenInspection" }];
}

interface CommConfig {
  senderEmail: string | null;
  replyTo: string | null;
  resendConfigured: boolean;
  emailMode: "platform" | "own";
  senderDisplayName: string | null;
  useInspectorFromName: boolean;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  const api = createApi(context, { token });

  // Fetch communication config + secrets + email templates + SMS config/tenant-config in parallel
  const [commRes, secretsRes, tplRes, smsCfgRes, tenantCfgRes] = await Promise.all([
    api.admin.communication.$get().catch(() => null),
    api.secrets.secrets.$get().catch(() => null),
    api.emailTemplates["email-templates"].$get().catch(() => null),
    api.smsAdmin.sms.config.$get().catch(() => null),
    api.admin["tenant-config"].$get().catch(() => null),
  ]);

  const commBody = commRes?.ok ? ((await commRes.json()) as Record<string, unknown>) : {};
  const d = (commBody.data ?? {}) as Record<string, unknown>;

  const secretsBody = secretsRes?.ok ? ((await secretsRes.json()) as Record<string, unknown>) : {};
  const secrets = (secretsBody.data ?? {}) as Record<string, string>;

  const tplBody = tplRes?.ok ? ((await tplRes.json()) as Record<string, unknown>) : {};
  const emailTemplates = (Array.isArray(tplBody.data) ? tplBody.data : []) as Array<{ trigger: string; name: string; category: string; required: boolean; enabled: boolean; isCustomized: boolean; subject: string }>;

  // Track L — SMS effective source (no secrets leaked) + tenant SMS config flags.
  const smsCfgBody = smsCfgRes?.ok ? ((await smsCfgRes.json()) as { data?: { mode?: "platform" | "own"; effectiveSource?: "platform" | "own" | "none" } }) : null;
  const smsConfig = {
    mode: smsCfgBody?.data?.mode ?? "platform",
    effectiveSource: smsCfgBody?.data?.effectiveSource ?? "none",
  };
  const tenantCfgBody = tenantCfgRes?.ok ? ((await tenantCfgRes.json()) as { data?: { smsMode?: "platform" | "own"; companyPhone?: string | null } }) : null;
  const companyPhone = tenantCfgBody?.data?.companyPhone ?? "";

  return {
    config: {
      senderEmail: (d?.senderEmail as string) || null,
      replyTo: (d?.replyTo as string) || null,
      resendConfigured: Boolean(d?.resendConfigured),
      emailMode: (d?.emailMode as "platform" | "own") || "platform",
      senderDisplayName: (d?.senderDisplayName as string) || null,
      useInspectorFromName: Boolean(d?.useInspectorFromName),
    } as CommConfig,
    emailTemplates,
    icsUrl: (d?.icsUrl as string) || null,
    googleCalendarConnected: Boolean(d?.googleCalendarConnected),
    secrets: {
      RESEND_API_KEY: secrets.RESEND_API_KEY || "",
      GOOGLE_CLIENT_ID: secrets.GOOGLE_CLIENT_ID || "",
      GOOGLE_CLIENT_SECRET: secrets.GOOGLE_CLIENT_SECRET || "",
      TWILIO_ACCOUNT_SID: secrets.TWILIO_ACCOUNT_SID || "",
      TWILIO_AUTH_TOKEN: secrets.TWILIO_AUTH_TOKEN || "",
      TWILIO_FROM_NUMBER: secrets.TWILIO_FROM_NUMBER || "",
    },
    smsConfig,
    companyPhone,
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
    const { senderEmail, replyTo, emailMode, senderDisplayName, useInspectorFromName } = submission.value;
    const res = await api.admin.communication.$patch({
      json: {
        senderEmail: senderEmail || null,
        replyTo: replyTo || null,
        emailMode,
        senderDisplayName: senderDisplayName || null,
        useInspectorFromName,
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
    if (resendKey && typeof resendKey === "string" && resendKey.trim()) body.RESEND_API_KEY = resendKey;

    if (Object.keys(body).length > 0) {
      const res = await api.secrets.secrets.$put({ json: body });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => null)) as
          | { error?: { message?: string; field?: string } }
          | null;
        return {
          intent,
          ok: false,
          error: errBody?.error?.message ?? "Failed to save email secrets.",
          field: errBody?.error?.field ?? null,
          test: null,
        };
      }
    }
    return { intent, ok: true, error: null, field: null, test: null };
  }

  if (intent === "test-resend") {
    const res = await api.integrations.resend.test.$post();
    const body = (await res.json().catch(() => null)) as
      | { data?: { domains: number }; error?: { message?: string } }
      | null;
    if (!res.ok || !body?.data) {
      return {
        intent,
        ok: false,
        error: body?.error?.message ?? "Connection test failed.",
        field: null,
        test: null,
      };
    }
    return { intent, ok: true, error: null, field: null, test: body.data };
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
        const errBody = (await res.json().catch(() => null)) as
          | { error?: { message?: string; field?: string } }
          | null;
        return {
          intent,
          ok: false,
          error: errBody?.error?.message ?? "Failed to save calendar secrets.",
          field: errBody?.error?.field ?? null,
          test: null,
        };
      }
    }
    return { intent, ok: true, error: null, field: null, test: null };
  }

  // ─── Track L — SMS settings ───────────────────────────────────────────────
  if (intent === "save-sms-config") {
    const smsMode = form.get("smsMode") === "own" ? "own" : "platform";
    const companyPhone = String(form.get("companyPhone") ?? "").trim();
    const res = await api.admin["tenant-config"].$patch({
      json: { smsMode, companyPhone: companyPhone || null },
    });
    if (!res.ok) return { intent, ok: false, error: "Failed to save SMS settings.", field: null, test: null };
    return { intent, ok: true, error: null, field: null, test: null };
  }

  if (intent === "save-sms-secrets") {
    const body: Record<string, string> = {};
    for (const key of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"]) {
      const v = form.get(key);
      if (v && typeof v === "string" && v.trim()) body[key] = v.trim();
    }
    if (Object.keys(body).length > 0) {
      const res = await api.secrets.secrets.$put({ json: body });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => null)) as { error?: { message?: string; field?: string } } | null;
        return {
          intent, ok: false,
          error: errBody?.error?.message ?? "Failed to save Twilio credentials.",
          field: errBody?.error?.field ?? null, test: null,
        };
      }
    }
    return { intent, ok: true, error: null, field: null, test: null };
  }

  if (intent === "test-sms") {
    const to = String(form.get("to") ?? "").trim();
    const res = await api.smsAdmin.sms.test.$post({ json: { to } });
    const body = (await res.json().catch(() => null)) as { success?: boolean; error?: string } | null;
    if (!res.ok || !body?.success) {
      return { intent, ok: false, error: body?.error ?? "Test SMS failed.", field: null, test: null };
    }
    return { intent, ok: true, error: null, field: null, test: { sent: true } };
  }

  if (intent === "toggle-template") {
    const trigger = String(form.get("trigger") || "");
    const enabled = form.get("enabled") === "true";
    const res = await api.emailTemplates["email-templates"][":trigger"].$put({
      param: { trigger },
      json: { subject: null, blocks: null, enabled },
    });
    if (!res.ok) return { ok: false, error: "Failed to update template." };
    return { ok: true };
  }

  return { ok: true };
}

export default function SettingsCommunication() {
  const { config, emailTemplates, icsUrl, googleCalendarConnected, secrets, smsConfig, companyPhone } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const resendTestFetcher = useFetcher<typeof action>();
  const smsTestFetcher = useFetcher<typeof action>();
  const session = useSessionContext();

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

  const [mode, setMode] = useState<"platform" | "own">(config.emailMode);
  const [smsMode, setSmsMode] = useState<"platform" | "own">(smsConfig.mode);

  // Pending save state, per secret intent.
  const savingEmailSecrets =
    nav.state !== "idle" && nav.formData?.get("intent") === "save-email-secrets";
  const savingCalendarSecrets =
    nav.state !== "idle" && nav.formData?.get("intent") === "save-calendar-secrets";
  const savingSmsSecrets =
    nav.state !== "idle" && nav.formData?.get("intent") === "save-sms-secrets";
  const savingSmsConfig =
    nav.state !== "idle" && nav.formData?.get("intent") === "save-sms-config";

  // Inbound webhook URL: own number (or standalone) tenants own STOP/START. The
  // origin is resolved client-side; SaaS platform-number tenants don't see it.
  const showInboundUrl = !session?.branding.isSaas || smsMode === "own";
  const tenantSlug = session?.branding.tenantSlug ?? "";
  const inboundUrl =
    typeof window !== "undefined" && tenantSlug
      ? `${window.location.origin}/api/public/sms/inbound/${tenantSlug}`
      : "";

  // Transient success flash — visible for 4s after a secret save round-trip.
  // Errors persist until the next attempt (no auto-dismiss).
  const [flashVisible, setFlashVisible] = useState(false);
  useEffect(() => {
    const i = actionData && "intent" in actionData ? actionData.intent : null;
    if (
      (i === "save-email-secrets" || i === "save-calendar-secrets") &&
      actionData &&
      "ok" in actionData &&
      actionData.ok
    ) {
      setFlashVisible(true);
      const t = setTimeout(() => setFlashVisible(false), 4000);
      return () => clearTimeout(t);
    }
  }, [actionData]);

  // Map a server `field` error back onto the matching SecretField.
  const secretFieldError = (name: string): string | undefined => {
    if (
      actionData &&
      "field" in actionData &&
      actionData.field === name &&
      "ok" in actionData &&
      !actionData.ok
    ) {
      return actionData.error ?? undefined;
    }
    return undefined;
  };

  // Form-level error for a given secret intent (no field, or generic message).
  const secretFormError = (intent: string): string | null => {
    if (
      actionData &&
      "intent" in actionData &&
      actionData.intent === intent &&
      "ok" in actionData &&
      !actionData.ok
    ) {
      return actionData.error ?? null;
    }
    return null;
  };

  const resendTest = resendTestFetcher.data;

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

      {/* Flash — transient success for secret saves */}
      {flashVisible && (
        <div className="px-4 py-2.5 rounded-md bg-ih-ok-bg border border-ih-ok-fg/20 text-[13px] text-ih-ok-fg font-medium">
          Settings saved.
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

          {/* Mode switch */}
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
            <div>
              <label htmlFor={emailFields.senderDisplayName.id} className="block text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3 mb-1">Display name</label>
              <input
                type="text" name={emailFields.senderDisplayName.name} id={emailFields.senderDisplayName.id}
                defaultValue={config.senderDisplayName || ""} placeholder="Acme Inspections"
                className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
              />
              <p className="text-[11px] text-ih-fg-4 mt-1">Shown as the From name on outbound email.</p>
            </div>
            <div>
              <label htmlFor={emailFields.replyTo.id} className="block text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3 mb-1">Reply-to</label>
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

          <label className="flex items-center gap-2 text-[13px] text-ih-fg-2">
            <input
              type="checkbox" name={emailFields.useInspectorFromName.name}
              defaultChecked={config.useInspectorFromName}
              className="h-4 w-4 rounded border-ih-border"
            />
            Use the sending inspector&rsquo;s name as the display name (replies go to that inspector)
          </label>

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
        <resendTestFetcher.Form method="post" className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="intent" value="test-resend" />
          <button type="submit" disabled={resendTestFetcher.state !== "idle"}
            className="h-8 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[12px] font-bold text-ih-fg-2 hover:bg-ih-bg-muted transition-colors disabled:opacity-60">
            {resendTestFetcher.state !== "idle" ? "Testing…" : "Test connection"}
          </button>
          {resendTest && "intent" in resendTest && resendTest.intent === "test-resend" && resendTest.test && "domains" in resendTest.test && (
            <span className="text-[12px] text-ih-fg-2">
              Connected — {resendTest.test.domains} verified domain(s)
            </span>
          )}
          {resendTest && "intent" in resendTest && resendTest.intent === "test-resend" && "ok" in resendTest && !resendTest.ok && (
            <span className="text-[12px] text-ih-bad-fg">{resendTest.error}</span>
          )}
        </resendTestFetcher.Form>
      </section>

      {/* SMS delivery (Track L) */}
      <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-4">
        <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">SMS delivery</h3>
        <p className="text-[13px] text-ih-fg-3">
          Send appointment and report text messages via Twilio. Clients are texted only
          after they opt in (STOP replies are honored automatically). You pay Twilio&rsquo;s
          per-message rates directly.
        </p>

        {/* Mode + company phone */}
        <Form method="post" className="space-y-4">
          <input type="hidden" name="intent" value="save-sms-config" />
          <input type="hidden" name="smsMode" value={smsMode} />

          <div className="inline-flex rounded-md border border-ih-border overflow-hidden">
            {(["platform", "own"] as const).map((m) => (
              <button
                type="button" key={m} onClick={() => setSmsMode(m)}
                className={`px-3 h-8 flex items-center text-[12px] font-bold ${smsMode === m ? "bg-ih-primary text-white" : "bg-ih-bg-card text-ih-fg-2"}`}
              >
                {m === "platform" ? "Platform SMS" : "My own Twilio"}
              </button>
            ))}
          </div>
          <p className="text-[11px] font-bold text-ih-ok-fg">
            {smsConfig.effectiveSource === "own"
              ? "Using your Twilio"
              : smsConfig.effectiveSource === "platform"
                ? "Using platform SMS"
                : "SMS not configured — set your Twilio credentials below"}
          </p>

          <div>
            <label htmlFor="companyPhone" className="block text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3 mb-1">Company phone</label>
            <input
              type="tel" name="companyPhone" id="companyPhone" defaultValue={companyPhone}
              placeholder="+1 555 123 4567"
              className="w-full md:w-1/2 h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
            />
            <p className="text-[11px] text-ih-fg-4 mt-1">Shown in your texts as the call-back number (<code>{"{{company_phone}}"}</code>).</p>
          </div>

          <div className="flex justify-end pt-3 border-t border-ih-border">
            <button type="submit" disabled={savingSmsConfig}
              className="h-8 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 transition-colors disabled:opacity-60">
              {savingSmsConfig ? "Saving…" : "Save SMS settings"}
            </button>
          </div>
        </Form>

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
      </section>

      {/* Email templates */}
      <section className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">Email templates</h3>
          <span className="text-[11px] text-ih-fg-4">{emailTemplates.length} templates · click to customize</span>
        </div>
        {emailTemplates.length === 0 ? (
          <div className="bg-ih-bg-card border border-ih-border rounded-lg py-8 text-center text-[13px] text-ih-fg-3">No email templates available.</div>
        ) : (
          <TemplateList rows={emailTemplates} />
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
              error={secretFieldError("GOOGLE_CLIENT_ID")}
              hint="Enables Google Calendar sync. Create at console.cloud.google.com → APIs → OAuth 2.0"
            />
            <SecretField
              name="GOOGLE_CLIENT_SECRET"
              label="Google Client Secret"
              value={secrets.GOOGLE_CLIENT_SECRET}
              error={secretFieldError("GOOGLE_CLIENT_SECRET")}
              hint="Paired with Client ID above. Found in the same OAuth 2.0 credentials page"
            />
          </div>
          {secretFormError("save-calendar-secrets") &&
            !secretFieldError("GOOGLE_CLIENT_ID") &&
            !secretFieldError("GOOGLE_CLIENT_SECRET") && (
              <p className="text-[12px] text-ih-bad-fg">{secretFormError("save-calendar-secrets")}</p>
            )}
          <div className="flex justify-end pt-3 border-t border-ih-border">
            <button type="submit" disabled={savingCalendarSecrets}
              className="h-8 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed">
              {savingCalendarSecrets ? "Saving…" : "Save credentials"}
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
