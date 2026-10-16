import { useState } from "react";
import { Link, useLoaderData, useActionData, useNavigation } from "react-router";
import { Icon } from "@core/shared-ui";
import { SettingsCrumb } from "~/components/SettingsCrumb";
import { useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod/v4";
import type { Route } from "./+types/settings-communication";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { useFlash } from "~/hooks/useFlash";
import { makeCommunicationEmailSchema } from "~/lib/forms/settings-config.schema";
import { ownEmailProviderConfigured, type EmailByoProvider } from "~/lib/email-provider-config";
import { pickSecretFields, saveSecrets } from "~/lib/secret-intents.server";
import { secretErrorReaders } from "~/lib/secret-action-errors";
import { TemplateList } from "~/components/email-template/TemplateList";
import { useSessionContext } from "~/hooks/useSessionContext";
import { requireAdminLoader } from "~/lib/access.server";
import { AccessDenied } from "~/components/AccessDenied";
import { EmailDeliveryPanel } from "~/components/settings/EmailDeliveryPanel";
import { DeliveryAccountsRow } from "~/components/settings/DeliveryAccountsRow";
import { GoogleCalendarPanel } from "~/components/settings/GoogleCalendarPanel";
import { SectionNav } from "~/components/settings/SectionNav";
import { m } from "~/paraglide/messages";
import { getCloudflareEnv } from "~/lib/load-context";
import { getDeploymentProfile } from "../../server/lib/deployment-profile";

export function meta() {
  return [{ title: m.settings_comms_meta_title() }];
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

const EMAIL_PROVIDERS = ["resend", "sendgrid", "postmark", "mailgun"] as const;

/**
 * Communication is how messages read and when they go out: sender name and
 * address, reply-to, templates. The accounts and keys that send them are in
 * Integrations, so no email or SMS key reaches this page. The one fact it needs
 * about them, "the saved email provider is complete", is computed here and sent
 * as a yes/no.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { forbidden, token } = await requireAdminLoader(context, request);
  if (forbidden) return { forbidden: true as const };
  const api = createApi(context, { token });

  const [commRes, secretsRes, tplRes, tenantCfgRes] = await Promise.all([
    api.admin.communication.$get().catch(() => null),
    api.secrets.secrets.$get().catch(() => null),
    api.emailTemplates["email-templates"].$get().catch(() => null),
    api.admin["tenant-config"].$get().catch(() => null),
  ]);

  const commBody = commRes?.ok ? ((await commRes.json()) as Record<string, unknown>) : {};
  const d = (commBody.data ?? {}) as Record<string, unknown>;

  const secretsBody = secretsRes?.ok ? ((await secretsRes.json()) as Record<string, unknown>) : {};
  const secrets = (secretsBody.data ?? {}) as Record<string, string>;

  const tplBody = tplRes?.ok ? ((await tplRes.json()) as Record<string, unknown>) : {};
  const emailTemplates = (Array.isArray(tplBody.data) ? tplBody.data : []) as Array<{ trigger: string; name: string; category: string; required: boolean; enabled: boolean; isCustomized: boolean; subject: string }>;

  const tenantCfg = tenantCfgRes?.ok ? ((await tenantCfgRes.json()) as { data?: { emailByoProvider?: string | null } }).data : null;
  const saved = tenantCfg?.emailByoProvider ?? "";
  const emailByoProvider: EmailByoProvider = (EMAIL_PROVIDERS as readonly string[]).includes(saved) ? (saved as EmailByoProvider) : "resend";

  const config: CommConfig = {
    senderEmail: (d?.senderEmail as string) || null,
    replyTo: (d?.replyTo as string) || null,
    resendConfigured: Boolean(d?.resendConfigured),
    emailMode: (d?.emailMode as "platform" | "own") || "platform",
    senderDisplayName: (d?.senderDisplayName as string) || null,
    companyName: (d?.companyName as string) || null,
    pointOfContact: (d?.pointOfContact as string) === "inspector" ? "inspector" : "company",
  };

  return {
    config,
    // A deployment that supplies no sender of its own leaves the company only its
    // own account, whatever the stored value says. Capability, not mode.
    effectiveEmailMode: getDeploymentProfile(getCloudflareEnv(context)).providesEmailSource ? config.emailMode : ("own" as const),
    emailTemplates,
    googleOAuthConfigured: Boolean(d?.googleOAuthConfigured),
    googleOAuthMode: (d?.googleOAuthMode as "platform" | "own") || "platform",
    emailByoProvider,
    ownEmailConfigured: ownEmailProviderConfigured(emailByoProvider, {
      RESEND_API_KEY: secrets.RESEND_API_KEY || "",
      SENDGRID_API_KEY: secrets.SENDGRID_API_KEY || "",
      POSTMARK_SERVER_TOKEN: secrets.POSTMARK_SERVER_TOKEN || "",
      MAILGUN_API_KEY: secrets.MAILGUN_API_KEY || "",
      MAILGUN_DOMAIN: secrets.MAILGUN_DOMAIN || "",
    }),
    secrets: {
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
    const submission = parseWithZod(form, { schema: makeCommunicationEmailSchema() });
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
      const serverMsg = errBody?.error?.message ?? m.settings_comms_email_save_error();
      return { intent: "save-email", ok: false, error: serverMsg };
    }
    return { intent: "save-email", ok: true, error: null };
  }

  if (intent === "save-calendar-secrets") {
    const body = pickSecretFields(form, ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]);
    return saveSecrets(api, intent, body, m.settings_comms_calendar_secrets_save_error());
  }

  if (intent === "save-google-oauth-mode") {
    const raw = form.get("googleOAuthMode");
    const googleOAuthMode: "platform" | "own" = raw === "own" ? "own" : "platform";
    const commRes = await api.admin.communication.$get();
    const commBody = commRes.ok
      ? ((await commRes.json()) as { data?: Record<string, unknown> })
      : null;
    const comm = commBody?.data ?? {};
    const patchRes = await api.admin.communication.$patch({
      json: {
        senderEmail: (comm.senderEmail as string | null) ?? null,
        replyTo: (comm.replyTo as string | null) ?? null,
        emailMode: (comm.emailMode as "platform" | "own") ?? "platform",
        senderDisplayName: (comm.senderDisplayName as string | null) ?? null,
        pointOfContact: (comm.pointOfContact as "inspector" | "company") ?? "company",
        googleOAuthMode,
      },
    });
    if (!patchRes.ok) {
      return { intent, ok: false, error: m.settings_comms_google_oauth_mode_save_error(), field: null, test: null };
    }
    return { intent, ok: true, error: null, field: null, test: null };
  }

  if (intent === "toggle-template") {
    const trigger = String(form.get("trigger") || "");
    const enabled = form.get("enabled") === "true";
    const res = await api.emailTemplates["email-templates"][":trigger"].$put({
      param: { trigger },
      json: { subject: null, blocks: null, enabled },
    });
    if (!res.ok) return { ok: false, error: m.settings_comms_template_update_error() };
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
  const googleOAuthConfigured = denied ? false : loaderResult.googleOAuthConfigured;
  const googleOAuthMode = denied ? ("platform" as const) : loaderResult.googleOAuthMode;
  const secrets = denied ? { GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "" } : loaderResult.secrets;
  const emailByoProvider = denied ? ("resend" as const) : loaderResult.emailByoProvider;
  const ownEmailConfigured = denied ? false : loaderResult.ownEmailConfigured;
  const mode: "platform" | "own" = denied ? "own" : loaderResult.effectiveEmailMode;
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const session = useSessionContext();
  // Whether the Google client is the deployment's or the company's follows from
  // who owns the app; the sending account is chosen in Integrations -> Email.
  const isSaas = session?.branding?.isSaas ?? false;

  // Only the `save-email` intent returns a Conform SubmissionResult; the
  // secret-paste intents return `{ ok }`. Feed Conform its own result only.
  const emailResult =
    actionData && !("ok" in actionData) ? actionData : undefined;
  const [emailForm, emailFields] = useForm({
    lastResult: emailResult,
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: makeCommunicationEmailSchema() });
    },
    shouldValidate: "onBlur",
    shouldRevalidate: "onInput",
  });

  // Override toggle: ON when senderDisplayName is set AND differs from companyName.
  const [overrideName, setOverrideName] = useState<boolean>(
    !!config.senderDisplayName && config.senderDisplayName !== config.companyName
  );
  // Track current PoC selection for the identity summary line.
  const [poc, setPoc] = useState<"inspector" | "company">(config.pointOfContact);

  const savingCalendarSecrets = nav.state !== "idle" && nav.formData?.get("intent") === "save-calendar-secrets";
  const savingGoogleOAuthMode = nav.state !== "idle" && nav.formData?.get("intent") === "save-google-oauth-mode";

  // Transient success flash: visible for 4s after a save round-trip.
  const flashIntent = actionData && "intent" in actionData ? actionData.intent : null;
  const { flashVisible } = useFlash(
    (flashIntent === "save-calendar-secrets" || flashIntent === "save-google-oauth-mode") &&
      !!actionData &&
      "ok" in actionData &&
      actionData.ok,
    actionData,
  );
  const { fieldError: secretFieldError, formError: secretFormError } = secretErrorReaders(actionData);

  if (denied) return <AccessDenied />;

  const navSections = [
    { id: "email-delivery", label: m.settings_emaildelivery_heading() },
    { id: "delivery-accounts", label: m.settings_comms_delivery_heading() },
    { id: "email-templates", label: m.settings_comms_email_templates_heading() },
    { id: "google-calendar", label: m.settings_comms_nav_calendar() },
  ];

  return (
    <div className="space-y-ih-list">
      <SettingsCrumb items={[{ label: m.settings_crumb_root(), href: "/settings" }, { label: m.settings_comms_crumb() }]} />
      <p className="text-[13px] text-ih-fg-3">
        {m.settings_comms_intro()}
      </p>

      {flashVisible && (
        <div className="px-4 py-2.5 rounded-md bg-ih-ok-bg border border-ih-ok-fg/20 text-[13px] text-ih-ok-fg font-medium">
          {m.settings_flash_saved()}
        </div>
      )}

      {/* In-page section navigation (sticky; scroll-spy). Shows only when ≥3 sections visible. */}
      <SectionNav sections={navSections} />

      {/* Sender name, sender address and reply-to */}
      <div id="email-delivery" className="scroll-mt-12">
        <EmailDeliveryPanel
          config={config}
          emailByoProvider={emailByoProvider}
          ownProviderConfigured={ownEmailConfigured}
          mode={mode}
          overrideName={overrideName}
          setOverrideName={setOverrideName}
          poc={poc}
          setPoc={setPoc}
          emailForm={emailForm}
          emailFields={emailFields}
          secretFormError={secretFormError}
        />
      </div>

      {/* Where the accounts and keys that send email and SMS are managed */}
      <div id="delivery-accounts" className="scroll-mt-12">
        <DeliveryAccountsRow />
      </div>

      {/* Email templates */}
      <section id="email-templates" className="space-y-4 scroll-mt-12">
        <div className="flex items-baseline justify-between">
          <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">{m.settings_comms_email_templates_heading()}</h3>
          <div className="flex items-center gap-3">
            <Link to="/settings/communication/templates" className="inline-flex items-center gap-1 text-[12px] text-ih-primary-text font-semibold hover:underline">
              {m.settings_comms_manage_templates_link()} <Icon name="arrowR" size={12} />
            </Link>
            <span className="text-[11px] text-ih-fg-3">{m.settings_comms_templates_count({ count: emailTemplates.length })}</span>
          </div>
        </div>
        {emailTemplates.length === 0 ? (
          <div className="bg-ih-bg-card border border-ih-border rounded-lg py-8 text-center text-[13px] text-ih-fg-3">{m.settings_comms_no_templates()}</div>
        ) : (
          <TemplateList rows={emailTemplates} />
        )}
      </section>

      {/* Company-level Google OAuth app configuration */}
      <div id="google-calendar" className="scroll-mt-12">
        <GoogleCalendarPanel
          isSaas={isSaas}
          googleOAuthConfigured={googleOAuthConfigured}
          googleOAuthMode={googleOAuthMode}
          secrets={secrets}
          secretFieldError={secretFieldError}
          secretFormError={secretFormError}
          savingCalendarSecrets={savingCalendarSecrets}
          savingOAuthMode={savingGoogleOAuthMode}
        />
      </div>
    </div>
  );
}
