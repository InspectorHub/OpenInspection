import { useState } from "react";
import { Link, useLoaderData, useActionData, useNavigation, useFetcher } from "react-router";
import { useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod/v4";
import type { Route } from "./+types/settings-communication";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { useFlash } from "~/hooks/useFlash";
import { communicationEmailSchema } from "~/lib/forms/settings-config.schema";
import { ownEmailProviderConfigured } from "~/lib/email-provider-config";
import { TemplateList } from "~/components/email-template/TemplateList";
import { useSessionContext } from "~/hooks/useSessionContext";
import { requireAdminLoader } from "~/lib/access.server";
import { AccessDenied } from "~/components/AccessDenied";
import { EmailDeliveryPanel } from "~/components/settings/EmailDeliveryPanel";
import { EmailSecretsPanel } from "~/components/settings/EmailSecretsPanel";
import { SmsDeliveryPanel, type SmsModeValue } from "~/components/settings/SmsDeliveryPanel";
import { GoogleCalendarPanel } from "~/components/settings/GoogleCalendarPanel";

export function meta() {
  return [{ title: "Communication - Settings - OpenInspection" }];
}

interface CommConfig {
  senderEmail: string | null;
  replyTo: string | null;
  resendConfigured: boolean;
  emailMode: "platform" | "own";
  senderDisplayName: string | null;
  companyName: string | null;
  pointOfContact: "inspector" | "company";
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { forbidden, token } = await requireAdminLoader(context, request);
  if (forbidden) return { forbidden: true as const };
  const api = createApi(context, { token });

  // Fetch communication config + secrets + email templates + SMS config/tenant-config/compliance in parallel
  const [commRes, secretsRes, tplRes, smsCfgRes, tenantCfgRes, smsComplianceRes] = await Promise.all([
    api.admin.communication.$get().catch(() => null),
    api.secrets.secrets.$get().catch(() => null),
    api.emailTemplates["email-templates"].$get().catch(() => null),
    api.smsAdmin.sms.config.$get().catch(() => null),
    api.admin["tenant-config"].$get().catch(() => null),
    api.smsAdmin.sms.compliance.$get().catch(() => null),
  ]);

  const commBody = commRes?.ok ? ((await commRes.json()) as Record<string, unknown>) : {};
  const d = (commBody.data ?? {}) as Record<string, unknown>;

  const secretsBody = secretsRes?.ok ? ((await secretsRes.json()) as Record<string, unknown>) : {};
  const secrets = (secretsBody.data ?? {}) as Record<string, string>;

  const tplBody = tplRes?.ok ? ((await tplRes.json()) as Record<string, unknown>) : {};
  const emailTemplates = (Array.isArray(tplBody.data) ? tplBody.data : []) as Array<{ trigger: string; name: string; category: string; required: boolean; enabled: boolean; isCustomized: boolean; subject: string }>;

  // Track L — SMS effective source (no secrets leaked) + tenant SMS config flags.
  const smsCfgBody = smsCfgRes?.ok ? ((await smsCfgRes.json()) as { data?: { mode?: "platform" | "own" | "managed_shared" | "managed_dedicated"; effectiveSource?: "platform" | "own" | "none" } }) : null;
  const smsConfig = {
    mode: smsCfgBody?.data?.mode ?? "platform",
    effectiveSource: smsCfgBody?.data?.effectiveSource ?? "none",
  };
  const tenantCfgBody = tenantCfgRes?.ok ? ((await tenantCfgRes.json()) as { data?: { smsMode?: "platform" | "own" | "managed_shared" | "managed_dedicated"; companyPhone?: string | null; smsByoProvider?: "twilio" | "telnyx" | null; emailByoProvider?: "resend" | "sendgrid" | "postmark" | "mailgun" | null } }) : null;
  const companyPhone = tenantCfgBody?.data?.companyPhone ?? "";
  const byoProvider: "twilio" | "telnyx" = tenantCfgBody?.data?.smsByoProvider === "telnyx" ? "telnyx" : "twilio";
  const emailByoProvider: "resend" | "sendgrid" | "postmark" | "mailgun" =
    (["resend", "sendgrid", "postmark", "mailgun"] as const).includes(
      tenantCfgBody?.data?.emailByoProvider as "resend" | "sendgrid" | "postmark" | "mailgun"
    )
      ? (tenantCfgBody!.data!.emailByoProvider as "resend" | "sendgrid" | "postmark" | "mailgun")
      : "resend";

  // SMS compliance status (BYO Twilio toll-free verification). Fails gracefully
  // to not_started so the UI always has a defined value to render.
  type ComplianceStatus = "not_started" | "profile_pending" | "brand_pending" | "campaign_pending" | "tfv_pending" | "approved" | "rejected";
  const smsComplianceBody = smsComplianceRes?.ok
    ? ((await smsComplianceRes.json()) as { data?: { complianceStatus?: ComplianceStatus | null; rejectionReason?: string | null } })
    : null;
  const compliance = {
    complianceStatus: (smsComplianceBody?.data?.complianceStatus ?? "not_started") as ComplianceStatus,
    rejectionReason: smsComplianceBody?.data?.rejectionReason ?? null,
  };

  return {
    config: {
      senderEmail: (d?.senderEmail as string) || null,
      replyTo: (d?.replyTo as string) || null,
      resendConfigured: Boolean(d?.resendConfigured),
      emailMode: (d?.emailMode as "platform" | "own") || "platform",
      senderDisplayName: (d?.senderDisplayName as string) || null,
      companyName: (d?.companyName as string) || null,
      pointOfContact: ((d?.pointOfContact as string) === "inspector" ? "inspector" : "company") as "inspector" | "company",
    } as CommConfig,
    emailTemplates,
    icsUrl: (d?.icsUrl as string) || null,
    googleCalendarConnected: Boolean(d?.googleCalendarConnected),
    secrets: {
      RESEND_API_KEY: secrets.RESEND_API_KEY || "",
      SENDGRID_API_KEY: secrets.SENDGRID_API_KEY || "",
      POSTMARK_SERVER_TOKEN: secrets.POSTMARK_SERVER_TOKEN || "",
      MAILGUN_API_KEY: secrets.MAILGUN_API_KEY || "",
      MAILGUN_DOMAIN: secrets.MAILGUN_DOMAIN || "",
      GOOGLE_CLIENT_ID: secrets.GOOGLE_CLIENT_ID || "",
      GOOGLE_CLIENT_SECRET: secrets.GOOGLE_CLIENT_SECRET || "",
      TWILIO_ACCOUNT_SID: secrets.TWILIO_ACCOUNT_SID || "",
      TWILIO_AUTH_TOKEN: secrets.TWILIO_AUTH_TOKEN || "",
      TWILIO_FROM_NUMBER: secrets.TWILIO_FROM_NUMBER || "",
      TELNYX_API_KEY: secrets.TELNYX_API_KEY || "",
      TELNYX_FROM_NUMBER: secrets.TELNYX_FROM_NUMBER || "",
    },
    smsConfig,
    companyPhone,
    byoProvider,
    emailByoProvider,
    compliance,
  };
}

type SecretActionResult = {
  intent: string;
  ok: boolean;
  error: string | null;
  field: string | null;
  test: null;
};

// Shared persistence for the "paste API keys" intents: PUT the (already
// filtered) secret body, then return the uniform action-result shape. An empty
// body is a no-op success — the user submitted the form without changing keys.
async function saveSecrets(
  api: ReturnType<typeof createApi>,
  intent: string,
  body: Record<string, string>,
  fallbackError: string,
): Promise<SecretActionResult> {
  if (Object.keys(body).length === 0) {
    return { intent, ok: true, error: null, field: null, test: null };
  }
  const res = await api.secrets.secrets.$put({ json: body });
  if (!res.ok) {
    const errBody = (await res.json().catch(() => null)) as
      | { error?: { message?: string; field?: string } }
      | null;
    return {
      intent,
      ok: false,
      error: errBody?.error?.message ?? fallbackError,
      field: errBody?.error?.field ?? null,
      test: null,
    };
  }
  return { intent, ok: true, error: null, field: null, test: null };
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
    const { senderEmail, replyTo, emailMode, senderDisplayName, pointOfContact } = submission.value;
    const res = await api.admin.communication.$patch({
      json: {
        senderEmail: senderEmail || null,
        replyTo: replyTo || null,
        emailMode,
        senderDisplayName: senderDisplayName || null,
        pointOfContact,
      },
    });
    if (!res.ok) {
      const errBody = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      const serverMsg = errBody?.error?.message ?? "Failed to save email settings.";
      return { intent: "save-email", ok: false, error: serverMsg };
    }
    return { intent: "save-email", ok: true, error: null };
  }

  if (intent === "save-email-secrets") {
    const VALID_EMAIL_PROVIDERS = ["resend", "sendgrid", "postmark", "mailgun"] as const;
    type EmailByoProvider = typeof VALID_EMAIL_PROVIDERS[number];
    const rawProvider = form.get("email_byo_provider");
    const emailByoProvider: EmailByoProvider = (VALID_EMAIL_PROVIDERS as ReadonlyArray<string>).includes(rawProvider as string)
      ? (rawProvider as EmailByoProvider)
      : "resend";
    const body: Record<string, string> = {};
    // Collect only the non-empty secret fields relevant to the selected provider.
    for (const key of ["RESEND_API_KEY", "SENDGRID_API_KEY", "POSTMARK_SERVER_TOKEN", "MAILGUN_API_KEY", "MAILGUN_DOMAIN"]) {
      const v = form.get(key);
      if (v && typeof v === "string" && v.trim()) body[key] = v.trim();
    }
    // Persist the provider selection on the tenant config first, then save secrets.
    const cfgRes = await api.admin["tenant-config"].$patch({
      json: { emailByoProvider },
    }).catch(() => null);
    if (cfgRes && !cfgRes.ok) {
      return { intent, ok: false, error: "Failed to save provider selection.", field: null, test: null };
    }
    return saveSecrets(api, intent, body, "Failed to save email secrets.");
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

  if (intent === "validate-email-provider") {
    const VALID_PROVIDERS = ["resend", "sendgrid", "postmark", "mailgun"] as const;
    type EmailProvider = typeof VALID_PROVIDERS[number];
    const rawProvider = form.get("provider");
    if (!rawProvider || !(VALID_PROVIDERS as ReadonlyArray<string>).includes(rawProvider as string)) {
      return { intent, ok: false, error: "Unknown provider.", field: null, test: null };
    }
    const provider = rawProvider as EmailProvider;
    const res = await api.integrations.email.validate.$post({ json: { provider } });
    const body = (await res.json().catch(() => null)) as
      | { data?: { ok: boolean }; error?: { message?: string } }
      | null;
    if (!res.ok || !body?.data?.ok) {
      return {
        intent,
        ok: false,
        error: body?.error?.message ?? "Credential validation failed.",
        field: null,
        test: null,
      };
    }
    return { intent, ok: true, error: null, field: null, test: null };
  }

  if (intent === "save-calendar-secrets") {
    const body: Record<string, string> = {};
    const clientId = form.get("GOOGLE_CLIENT_ID");
    const clientSecret = form.get("GOOGLE_CLIENT_SECRET");
    if (clientId && typeof clientId === "string" && clientId.trim()) body.GOOGLE_CLIENT_ID = clientId;
    if (clientSecret && typeof clientSecret === "string" && clientSecret.trim()) body.GOOGLE_CLIENT_SECRET = clientSecret;
    return saveSecrets(api, intent, body, "Failed to save calendar secrets.");
  }

  // ─── Track L — SMS settings ───────────────────────────────────────────────
  if (intent === "save-sms-config") {
    // Pass through the three valid tenant modes; never submit "platform" (first-party only).
    const rawMode = form.get("smsMode");
    const VALID_TENANT_MODES = ["own", "managed_shared", "managed_dedicated"] as const;
    type TenantSmsMode = typeof VALID_TENANT_MODES[number];
    const smsMode: TenantSmsMode = (VALID_TENANT_MODES as ReadonlyArray<string>).includes(rawMode as string)
      ? (rawMode as TenantSmsMode)
      : "own";
    const companyPhone = String(form.get("companyPhone") ?? "").trim();
    const res = await api.admin["tenant-config"].$patch({
      json: { smsMode, companyPhone: companyPhone || null },
    });
    if (!res.ok) return { intent, ok: false, error: "Failed to save SMS settings.", field: null, test: null };
    return { intent, ok: true, error: null, field: null, test: null };
  }

  if (intent === "save-sms-secrets") {
    const rawProvider = form.get("sms_byo_provider");
    const byoProvider: "twilio" | "telnyx" =
      rawProvider === "telnyx" ? "telnyx" : "twilio";
    const body: Record<string, string> = {};
    if (byoProvider === "twilio") {
      for (const key of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"]) {
        const v = form.get(key);
        if (v && typeof v === "string" && v.trim()) body[key] = v.trim();
      }
    } else {
      for (const key of ["TELNYX_API_KEY", "TELNYX_FROM_NUMBER"]) {
        const v = form.get(key);
        if (v && typeof v === "string" && v.trim()) body[key] = v.trim();
      }
    }
    // Persist sms_byo_provider on the tenant config alongside the secrets save.
    const cfgRes = await api.admin["tenant-config"].$patch({
      json: { smsByoProvider: byoProvider },
    }).catch(() => null);
    if (cfgRes && !cfgRes.ok) {
      return { intent, ok: false, error: "Failed to save provider selection.", field: null, test: null };
    }
    return saveSecrets(api, intent, body, "Failed to save SMS credentials.");
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
  const loaderResult = useLoaderData<typeof loader>();
  // Non-admins get a forbidden flag and no data; supply inert defaults so the
  // hooks below stay unconditional, then render <AccessDenied/> before any UI.
  const denied = "forbidden" in loaderResult;
  const EMPTY_CONFIG: CommConfig = {
    senderEmail: null, replyTo: null, resendConfigured: false, emailMode: "platform",
    senderDisplayName: null, companyName: null, pointOfContact: "company",
  };
  const config = denied ? EMPTY_CONFIG : loaderResult.config;
  const emailTemplates = denied ? [] : loaderResult.emailTemplates;
  const icsUrl = denied ? null : loaderResult.icsUrl;
  const googleCalendarConnected = denied ? false : loaderResult.googleCalendarConnected;
  const secrets = denied
    ? { RESEND_API_KEY: "", SENDGRID_API_KEY: "", POSTMARK_SERVER_TOKEN: "", MAILGUN_API_KEY: "", MAILGUN_DOMAIN: "", GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "", TWILIO_ACCOUNT_SID: "", TWILIO_AUTH_TOKEN: "", TWILIO_FROM_NUMBER: "", TELNYX_API_KEY: "", TELNYX_FROM_NUMBER: "" }
    : loaderResult.secrets;
  const smsConfig = denied ? { mode: "platform" as const, effectiveSource: "none" as const } : loaderResult.smsConfig as { mode: "platform" | "own" | "managed_shared" | "managed_dedicated"; effectiveSource: "platform" | "own" | "none" };
  const companyPhone = denied ? "" : loaderResult.companyPhone;
  const byoProvider = denied ? ("twilio" as const) : loaderResult.byoProvider;
  const emailByoProvider = denied ? ("resend" as const) : loaderResult.emailByoProvider;
  const compliance = denied ? { complianceStatus: "not_started" as const, rejectionReason: null } : loaderResult.compliance;
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const resendTestFetcher = useFetcher<typeof action>();
  const emailValidateFetcher = useFetcher<typeof action>();
  const smsTestFetcher = useFetcher<typeof action>();
  const session = useSessionContext();
  // Self-host (standalone) deployments have no platform mailbox / SMS number —
  // tenants MUST bring their own provider keys. Force `own` and hide the
  // platform/own toggle entirely; SaaS is unchanged.
  const isSaas = session?.branding?.isSaas ?? false;

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

  const [mode, setMode] = useState<"platform" | "own">(isSaas ? config.emailMode : "own");
  // SaaS default is managed_shared; standalone is always own (BYO-only).
  // If the stored value is the legacy "platform" mode (first-party only), treat it
  // as "managed_shared" for display purposes — tenants cannot select "platform".
  const resolvedSmsMode: SmsModeValue =
    !isSaas
      ? "own"
      : smsConfig.mode === "own" || smsConfig.mode === "managed_shared" || smsConfig.mode === "managed_dedicated"
        ? smsConfig.mode
        : "managed_shared";
  const [smsMode, setSmsMode] = useState<SmsModeValue>(resolvedSmsMode);
  // Override toggle: ON when senderDisplayName is set AND differs from companyName.
  const [overrideName, setOverrideName] = useState<boolean>(
    !!config.senderDisplayName && config.senderDisplayName !== config.companyName
  );
  // Track current PoC selection for the identity summary line.
  const [poc, setPoc] = useState<"inspector" | "company">(config.pointOfContact);

  // Pending save state, per secret intent.
  const savingEmailSecrets =
    nav.state !== "idle" && nav.formData?.get("intent") === "save-email-secrets";
  const savingCalendarSecrets =
    nav.state !== "idle" && nav.formData?.get("intent") === "save-calendar-secrets";
  const savingSmsSecrets =
    nav.state !== "idle" && nav.formData?.get("intent") === "save-sms-secrets";
  const savingSmsConfig =
    nav.state !== "idle" && nav.formData?.get("intent") === "save-sms-config";

  // Inbound webhook URL: BYO tenants (own mode) and standalone deployments own STOP/START.
  // Managed-number tenants don't set up their own inbound webhook.
  const showInboundUrl = !session?.branding.isSaas || smsMode === "own";
  const tenantSlug = session?.branding.tenantSlug ?? "";
  const inboundUrl =
    typeof window !== "undefined" && tenantSlug
      ? `${window.location.origin}/api/public/sms/inbound/${tenantSlug}`
      : "";

  // Transient success flash — visible for 4s after a secret save round-trip.
  // Errors persist until the next attempt (no auto-dismiss).
  const flashIntent = actionData && "intent" in actionData ? actionData.intent : null;
  const { flashVisible } = useFlash(
    (flashIntent === "save-email-secrets" || flashIntent === "save-calendar-secrets") &&
      !!actionData &&
      "ok" in actionData &&
      actionData.ok,
    actionData,
  );

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

  // Whether the tenant's OWN selected email provider has its credentials saved
  // (drives the Email delivery panel's provider-aware guardrail + status copy).
  const ownProviderConfigured = ownEmailProviderConfigured(emailByoProvider, secrets);

  if (denied) return <AccessDenied />;

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
      <EmailDeliveryPanel
        config={config}
        isSaas={isSaas}
        emailByoProvider={emailByoProvider}
        ownProviderConfigured={ownProviderConfigured}
        mode={mode}
        setMode={setMode}
        overrideName={overrideName}
        setOverrideName={setOverrideName}
        poc={poc}
        setPoc={setPoc}
        emailForm={emailForm}
        emailFields={emailFields}
        secretFormError={secretFormError}
      />

      {/* Email API keys */}
      <EmailSecretsPanel
        secrets={secrets}
        secretFieldError={secretFieldError}
        secretFormError={secretFormError}
        savingEmailSecrets={savingEmailSecrets}
        resendTestFetcher={resendTestFetcher}
        resendTest={resendTest}
        emailValidateFetcher={emailValidateFetcher}
        initialProvider={emailByoProvider}
      />

      {/* SMS delivery (Track L) */}
      <SmsDeliveryPanel
        isSaas={isSaas}
        smsMode={smsMode}
        setSmsMode={setSmsMode}
        smsConfig={smsConfig}
        companyPhone={companyPhone}
        savingSmsConfig={savingSmsConfig}
        secrets={secrets}
        secretFieldError={secretFieldError}
        secretFormError={secretFormError}
        savingSmsSecrets={savingSmsSecrets}
        showInboundUrl={showInboundUrl}
        inboundUrl={inboundUrl}
        smsTestFetcher={smsTestFetcher}
        compliance={compliance}
        byoProvider={byoProvider}
      />

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

      {/* Google Calendar OAuth secrets + Calendar sync */}
      <GoogleCalendarPanel
        secrets={secrets}
        secretFieldError={secretFieldError}
        secretFormError={secretFormError}
        savingCalendarSecrets={savingCalendarSecrets}
        googleCalendarConnected={googleCalendarConnected}
        icsUrl={icsUrl}
      />
    </div>
  );
}
