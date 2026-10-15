import { useState } from "react";
import { Link, useLoaderData, useActionData, useNavigation, useFetcher } from "react-router";
import { Banner } from "@core/shared-ui";
import type { Route } from "./+types/settings-integrations-email";
import { SettingsCrumb } from "~/components/SettingsCrumb";
import { AccessDenied } from "~/components/AccessDenied";
import { requireToken } from "~/lib/session.server";
import { requireAdminLoader } from "~/lib/access.server";
import { createApi } from "~/lib/api-client.server";
import { runEmailTestStepIntent } from "~/lib/test-step.server";
import { pickSecretFields, saveSecrets } from "~/lib/secret-intents.server";
import { secretErrorReaders } from "~/lib/secret-action-errors";
import { ownEmailProviderConfigured, type EmailByoProvider } from "~/lib/email-provider-config";
import { parseTestResults } from "~/lib/connection-test";
import { fetchData } from "~/lib/fetch-data.server";
import { useFlash } from "~/hooks/useFlash";
import { useSessionContext } from "~/hooks/useSessionContext";
import { EmailSecretsPanel } from "~/components/settings/EmailSecretsPanel";
import { DeliveryConnectionCard } from "~/components/settings/integrations/DeliveryConnectionCard";
import { FoldedAccountDetails } from "~/components/settings/integrations/FoldedAccountDetails";
import { SourceChoice, type SourceValue } from "~/components/settings/integrations/SourceChoice";
import { sourceChangeError } from "~/lib/integration-source-intent.server";
import { m } from "~/paraglide/messages";
import type { SwitchableSourceRow } from "../../server/lib/integrations/source-change";

export function meta() {
  return [{ title: m.integrations_email_meta_title() }];
}

const PROVIDERS = ["resend", "sendgrid", "postmark", "mailgun"] as const;
const SECRET_KEYS = [
  "RESEND_API_KEY", "SENDGRID_API_KEY", "POSTMARK_SERVER_TOKEN", "MAILGUN_API_KEY", "MAILGUN_DOMAIN",
  // Per-provider inbound webhook verification secrets.
  "RESEND_WEBHOOK_SECRET", "SENDGRID_WEBHOOK_PUBLIC_KEY", "POSTMARK_WEBHOOK_TOKEN", "MAILGUN_SIGNING_KEY",
] as const;

/** What the page assumes when the source call fails: own account only, and nothing is claimed to work. */
const FALLBACK_ROW: SwitchableSourceRow = {
  service: "email", choiceShown: false, available: ["own"], stored: null, current: "unavailable",
  reason: "profile_default", reasonKey: null, state: "not_connected", ownReady: false,
};

export async function loader({ request, context }: Route.LoaderArgs) {
  const { forbidden, token } = await requireAdminLoader(context, request);
  if (forbidden) return { forbidden: true as const };
  const api = createApi(context, { token });

  // One wave: every read starts together and is parsed where it lands.
  const [sources, comm, stored, tenantCfg, testResults] = await Promise.all([
    fetchData<SwitchableSourceRow[]>(api.admin["integration-sources"].$get()),
    fetchData<{ senderEmail?: string | null }>(api.admin.communication.$get()),
    fetchData<Record<string, string>>(api.secrets.secrets.$get()),
    fetchData<{ emailByoProvider?: string | null }>(api.admin["tenant-config"].$get()),
    api.integrations["test-results"].$get().catch(() => null).then(parseTestResults),
  ]);

  const source = (sources ?? []).find((r) => r.service === "email") ?? FALLBACK_ROW;
  const saved = tenantCfg?.emailByoProvider;
  const emailByoProvider: EmailByoProvider = (PROVIDERS as readonly string[]).includes(saved ?? "")
    ? (saved as EmailByoProvider)
    : "resend";

  return {
    source,
    senderEmail: comm?.senderEmail || null,
    emailByoProvider,
    // Masked values only; an empty string means "not set". Email keys only.
    secrets: Object.fromEntries(SECRET_KEYS.map((k) => [k, stored?.[k] || ""])) as Record<(typeof SECRET_KEYS)[number], string>,
    testResults,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const [token, form] = await Promise.all([requireToken(context, request), request.formData()]);
  const intent = String(form.get("intent") ?? "");
  const api = createApi(context, { token });

  if (intent === "save-source") {
    const source = form.get("source");
    if (source !== "provided" && source !== "own") {
      return { intent, ok: false, error: m.integrations_delivery_error_generic(), field: null, test: null };
    }
    // Only the choice is written. The company's keys stay where they are.
    const res = await api.admin["integration-sources"].$put({ json: { service: "email", source } });
    if (!res.ok) return { intent, ok: false, error: await sourceChangeError(res), field: null, test: null };
    return { intent, ok: true, error: null, field: null, test: null };
  }

  if (intent === "save-email-secrets") {
    const raw = form.get("email_byo_provider");
    const provider: EmailByoProvider = (PROVIDERS as readonly string[]).includes(raw as string) ? (raw as EmailByoProvider) : "resend";
    // The provider choice first, then the keys; a failed choice stops before any key is written.
    const cfgRes = await api.admin["tenant-config"].$patch({ json: { emailByoProvider: provider } }).catch(() => null);
    if (cfgRes && !cfgRes.ok) {
      return { intent, ok: false, error: m.settings_comms_provider_save_error(), field: null, test: null };
    }
    return saveSecrets(api, intent, pickSecretFields(form, SECRET_KEYS), m.settings_comms_email_secrets_save_error());
  }

  if (intent === "test-email-step") return runEmailTestStepIntent(api, intent, form.get("step"));

  if (intent === "validate-email-provider") {
    const raw = form.get("provider");
    if (!(PROVIDERS as readonly string[]).includes(raw as string)) {
      return { intent, ok: false, error: m.settings_comms_unknown_provider(), field: null, test: null };
    }
    const res = await api.integrations.email.validate.$post({ json: { provider: raw as EmailByoProvider } });
    const body = (await res.json().catch(() => null)) as { data?: { ok: boolean }; error?: { message?: string } } | null;
    if (!res.ok || !body?.data?.ok) {
      return { intent, ok: false, error: body?.error?.message ?? m.settings_comms_credential_validation_failed(), field: null, test: null };
    }
    return { intent, ok: true, error: null, field: null, test: null };
  }

  return { intent, ok: false, error: m.settings_unknown_action(), field: null, test: null };
}

function initialChoice(row: SwitchableSourceRow): SourceValue {
  if (!row.choiceShown) return "own";
  if (row.stored) return row.stored;
  if (row.current === "own") return "own";
  return row.available.includes("provided") ? "provided" : "own";
}

export default function SettingsIntegrationsEmail() {
  const data = useLoaderData<typeof loader>();
  if ("forbidden" in data) return <AccessDenied />;
  return <EmailPage data={data} />;
}

function EmailPage({ data }: { data: Exclude<Awaited<ReturnType<typeof loader>>, { forbidden: true }> }) {
  const { source: row, senderEmail, emailByoProvider, secrets, testResults } = data;
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const emailValidateFetcher = useFetcher<typeof action>();
  const session = useSessionContext();
  const [selected, setSelected] = useState<SourceValue>(() => initialChoice(row));
  const { fieldError, formError } = secretErrorReaders(actionData);

  const pendingIntent = nav.state !== "idle" ? nav.formData?.get("intent") : null;
  const sourceResult = actionData?.intent === "save-source" ? actionData : null;
  const { flashVisible } = useFlash(
    (actionData?.intent === "save-email-secrets" || actionData?.intent === "save-source") && actionData.ok,
    actionData,
  );

  // Own details are shown wherever "own" is the question: always on a deployment
  // with no built-in account, and when Your own is the selected choice otherwise.
  const showDetails = !row.choiceShown || selected === "own";
  const keysComplete = ownEmailProviderConfigured(emailByoProvider, secrets);
  const needsSender = showDetails && keysComplete && !senderEmail && !row.ownReady;

  return (
    <div className="space-y-ih-list">
      <SettingsCrumb
        items={[
          { label: m.settings_crumb_root(), href: "/settings" },
          { label: m.settings_integrations_crumb(), href: "/settings/integrations" },
          { label: m.integrations_hub_email_title() },
        ]}
      />
      <DeliveryConnectionCard
        title={m.integrations_hub_email_title()}
        description={m.integrations_hub_email_desc()}
        status={row.state}
        source={row.current}
        reasonKey={row.reasonKey}
      />

      {row.choiceShown && (
        <SourceChoice
          kind="email"
          available={row.available}
          selected={selected}
          onSelect={setSelected}
          saving={pendingIntent === "save-source"}
          error={sourceResult && !sourceResult.ok ? sourceResult.error : null}
          saved={flashVisible && sourceResult?.ok === true}
        />
      )}

      {needsSender && (
        <Banner
          tone="warn"
          actions={<Link to="/settings/communication" className="text-ih-primary-text underline">{m.integrations_email_open_communication()}</Link>}
        >
          {m.integrations_email_sender_missing()}
        </Banner>
      )}
      {flashVisible && actionData?.intent === "save-email-secrets" && actionData.ok && (
        <Banner tone="success">{m.settings_flash_saved()}</Banner>
      )}

      {showDetails ? (
        <FoldedAccountDetails complete={row.ownReady}>
          <EmailSecretsPanel
            secrets={secrets}
            secretFieldError={fieldError}
            secretFormError={formError}
            savingEmailSecrets={pendingIntent === "save-email-secrets"}
            emailValidateFetcher={emailValidateFetcher}
            initialProvider={emailByoProvider}
            webhookBaseUrl={typeof window !== "undefined" ? window.location.origin : ""}
            tenantSlug={session?.branding.tenantSlug ?? ""}
            testResults={testResults}
          />
        </FoldedAccountDetails>
      ) : (
        <p className="text-xs text-ih-fg-3">{m.integrations_delivery_keys_kept()}</p>
      )}
    </div>
  );
}
