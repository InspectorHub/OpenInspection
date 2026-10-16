import { useLoaderData, useActionData, useNavigation, useFetcher } from "react-router";
import type { Route } from "./+types/settings-integrations-sms";
import { SettingsCrumb } from "~/components/SettingsCrumb";
import { AccessDenied } from "~/components/AccessDenied";
import { requireToken } from "~/lib/session.server";
import { requireAdminLoader } from "~/lib/access.server";
import { createApi } from "~/lib/api-client.server";
import { getCloudflareEnv } from "~/lib/load-context";
import { pickSecretFields, saveSecrets } from "~/lib/secret-intents.server";
import { secretErrorReaders } from "~/lib/secret-action-errors";
import { runComplianceIntent, saveManagedProvider } from "~/lib/sms-compliance-intents.server";
import { parseTestResults } from "~/lib/connection-test";
import { fetchData } from "~/lib/fetch-data.server";
import { sourceChangeError } from "~/lib/integration-source-intent.server";
import { useSessionContext } from "~/hooks/useSessionContext";
import { DeliveryConnectionCard } from "~/components/settings/integrations/DeliveryConnectionCard";
import { SmsDeliveryPanel } from "~/components/settings/SmsDeliveryPanel";
import { ManagedComplianceWizard, type ManagedComplianceData } from "~/components/settings/ManagedComplianceWizard";
import { m } from "~/paraglide/messages";
import { getDeploymentProfile } from "../../server/lib/deployment-profile";
import type { SwitchableSourceRow } from "../../server/lib/integrations/source-change";

export function meta() {
  return [{ title: m.integrations_sms_meta_title() }];
}

type SmsMode = "platform" | "own" | "managed_shared" | "managed_dedicated";
type EffectiveSource = "platform" | "own" | "managed" | "none";
type ComplianceStatus = ManagedComplianceData["complianceStatus"];

const SECRET_KEYS = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "TELNYX_API_KEY", "TELNYX_FROM_NUMBER", "TELNYX_PUBLIC_KEY"] as const;

/** What the page assumes when the source call fails: own account only, and nothing is claimed to work. */
const FALLBACK_ROW: SwitchableSourceRow = {
  service: "sms", choiceShown: false, available: ["own"], stored: null, current: "unavailable",
  reason: "profile_default", reasonKey: null, state: "not_connected", dedicatedNumber: false, ownReady: false,
};

export async function loader({ request, context }: Route.LoaderArgs) {
  const { forbidden, token } = await requireAdminLoader(context, request);
  if (forbidden) return { forbidden: true as const };
  const api = createApi(context, { token });

  // One wave: every read starts together and is parsed where it lands.
  const [sources, comm, stored, smsCfg, tenantCfg, cb, testResults] = await Promise.all([
    fetchData<SwitchableSourceRow[]>(api.admin["integration-sources"].$get()),
    fetchData<{ legalName?: string }>(api.admin.communication.$get()),
    fetchData<Record<string, string>>(api.secrets.secrets.$get()),
    // Whose number the SMS goes out on now (no secrets).
    fetchData<{ mode?: SmsMode; effectiveSource?: EffectiveSource }>(api.smsAdmin.sms.config.$get()),
    fetchData<{ companyPhone?: string | null; smsByoProvider?: "twilio" | "telnyx" | null; managedProvider?: "twilio" | "telnyx" | null }>(api.admin["tenant-config"].$get()),
    // Registration status. Fails to "not started" so the page always has a value to draw.
    fetchData<{
      complianceStatus?: ComplianceStatus | null; rejectionReason?: string | null; customerProfileStatus?: string | null;
      brandStatus?: string | null; campaignStatus?: string | null; tfvStatus?: string | null;
      messagingServiceSid?: string | null; provisionedNumber?: string | null;
    }>(api.smsAdmin.sms.compliance.$get()),
    api.integrations["test-results"].$get().catch(() => null).then(parseTestResults),
  ]);

  const source = (sources ?? []).find((r) => r.service === "sms") ?? FALLBACK_ROW;
  const smsConfig = { mode: smsCfg?.mode ?? "platform", effectiveSource: smsCfg?.effectiveSource ?? "none" };
  const compliance: ManagedComplianceData = {
    complianceStatus: cb?.complianceStatus ?? "not_started",
    rejectionReason: cb?.rejectionReason ?? null,
    customerProfileStatus: cb?.customerProfileStatus ?? null,
    brandStatus: cb?.brandStatus ?? null,
    campaignStatus: cb?.campaignStatus ?? null,
    tfvStatus: cb?.tfvStatus ?? null,
    messagingServiceSid: cb?.messagingServiceSid ?? null,
    provisionedNumber: cb?.provisionedNumber ?? null,
  };

  return {
    source,
    smsConfig,
    companyPhone: tenantCfg?.companyPhone ?? "",
    byoProvider: (tenantCfg?.smsByoProvider === "telnyx" ? "telnyx" : "twilio") as "twilio" | "telnyx",
    // Which carrier runs the registration; separate from the provider a company sends through itself.
    managedProvider: (tenantCfg?.managedProvider === "telnyx" ? "telnyx" : "twilio") as "twilio" | "telnyx",
    compliance,
    legalName: comm?.legalName || "",
    // Registration onboarding exists only where the deployment files it, and is shown
    // only to a company that is already on it. Capability, not mode.
    showOnboarding: getDeploymentProfile(getCloudflareEnv(context)).hasManagedCompliance && smsConfig.mode === "managed_dedicated",
    secrets: Object.fromEntries(SECRET_KEYS.map((k) => [k, stored?.[k] || ""])) as Record<(typeof SECRET_KEYS)[number], string>,
    testResults,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const [token, form] = await Promise.all([requireToken(context, request), request.formData()]);
  const intent = String(form.get("intent") ?? "");
  const api = createApi(context, { token });

  if (intent === "save-sms-config") {
    const companyPhone = String(form.get("companyPhone") ?? "").trim();
    const res = await api.admin["tenant-config"].$patch({ json: { companyPhone: companyPhone || null } });
    if (!res.ok) return { intent, ok: false, error: m.settings_comms_sms_settings_save_error(), field: null, test: null };
    return { intent, ok: true, error: null, field: null, test: null };
  }

  if (intent === "save-sms-secrets") {
    const provider: "twilio" | "telnyx" = form.get("sms_byo_provider") === "telnyx" ? "telnyx" : "twilio";
    const keys = provider === "twilio"
      ? ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"]
      : ["TELNYX_API_KEY", "TELNYX_FROM_NUMBER", "TELNYX_PUBLIC_KEY"];
    // The provider choice first, then the keys; a failed choice stops before any key is written.
    const cfgRes = await api.admin["tenant-config"].$patch({ json: { smsByoProvider: provider } }).catch(() => null);
    if (cfgRes && !cfgRes.ok) {
      return { intent, ok: false, error: m.settings_comms_provider_save_error(), field: null, test: null };
    }
    const saved = await saveSecrets(api, intent, pickSecretFields(form, keys), m.settings_comms_sms_credentials_save_error());
    if (!saved.ok) return saved;
    // A hosted company still on a retired sender mode (the column default, or no
    // config row) can only turn SMS on by recording that it sends on its own
    // account. Same writer as the source endpoint, which also mirrors sms_mode.
    // A company on a registered number is left alone, and a 409 (details still
    // incomplete) is not an error: the keys are saved either way.
    if (getDeploymentProfile(getCloudflareEnv(context)).hasManagedCompliance) {
      const cfg = await fetchData<{ mode?: SmsMode }>(api.smsAdmin.sms.config.$get());
      if (cfg?.mode === "platform" || cfg?.mode === "managed_shared") {
        const res = await api.admin["integration-sources"].$put({ json: { service: "sms", source: "own" } }).catch(() => null);
        if (res && !res.ok && res.status !== 409) {
          return { intent, ok: false, error: await sourceChangeError(res), field: null, test: null };
        }
      }
    }
    return saved;
  }

  if (intent === "test-sms") {
    const to = String(form.get("to") ?? "").trim();
    const res = await api.smsAdmin.sms.test.$post({ json: { to } });
    const body = (await res.json().catch(() => null)) as { success?: boolean; error?: string } | null;
    if (!res.ok || !body?.success) {
      return { intent, ok: false, error: body?.error ?? m.settings_comms_test_sms_failed(), field: null, test: null };
    }
    return { intent, ok: true, error: null, field: null, test: { sent: true } };
  }

  if (intent === "sms-compliance-provision" || intent === "sms-compliance-resubmit") {
    return runComplianceIntent(api, context, intent, form);
  }
  if (intent === "save-managed-provider") return saveManagedProvider(api, form);

  return { intent, ok: false, error: m.settings_unknown_action(), field: null, test: null };
}

export default function SettingsIntegrationsSms() {
  const data = useLoaderData<typeof loader>();
  if ("forbidden" in data) return <AccessDenied />;
  return <SmsPage data={data} />;
}

function SmsPage({ data }: { data: Exclude<Awaited<ReturnType<typeof loader>>, { forbidden: true }> }) {
  const { source: row, smsConfig, companyPhone, byoProvider, managedProvider, compliance, legalName, showOnboarding, secrets, testResults } = data;
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const smsTestFetcher = useFetcher<typeof action>();
  const session = useSessionContext();
  const { fieldError, formError } = secretErrorReaders(actionData);

  const pendingIntent = nav.state !== "idle" ? nav.formData?.get("intent") : null;

  const tenantSlug = session?.branding.tenantSlug ?? "";
  const inboundUrl = typeof window !== "undefined" && tenantSlug ? `${window.location.origin}/webhooks/sms/inbound/${tenantSlug}` : "";
  const onboardingError = actionData && (actionData.intent === "sms-compliance-provision" || actionData.intent === "sms-compliance-resubmit") && !actionData.ok
    ? actionData.error : null;

  return (
    <div className="space-y-ih-list">
      <SettingsCrumb
        items={[
          { label: m.settings_crumb_root(), href: "/settings" },
          { label: m.settings_integrations_crumb(), href: "/settings/integrations" },
          { label: m.integrations_hub_sms_title() },
        ]}
      />
      <DeliveryConnectionCard
        title={m.integrations_hub_sms_title()}
        description={m.integrations_hub_sms_desc()}
        status={row.state}
        source={row.current}
        reasonKey={row.reasonKey}
        dedicated={row.dedicatedNumber}
      />

      {showOnboarding && (
        <section className="bg-ih-bg-card border border-ih-border rounded-ih-card p-5 space-y-4">
          <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">{m.settings_comms_dedicated_heading()}</h3>
          <p className="text-[13px] text-ih-fg-3">{m.settings_comms_dedicated_desc()}</p>
          <ManagedComplianceWizard
            compliance={compliance}
            legalName={legalName}
            managedProvider={managedProvider}
            savingManagedProvider={pendingIntent === "save-managed-provider"}
            actionError={onboardingError}
            saving={pendingIntent === "sms-compliance-provision" || pendingIntent === "sms-compliance-resubmit"}
          />
        </section>
      )}

      <SmsDeliveryPanel
        effectiveSource={smsConfig.effectiveSource}
        companyPhone={companyPhone}
        savingSmsConfig={pendingIntent === "save-sms-config"}
        byoProvider={byoProvider}
        compliance={compliance}
        showAccountDetails
        accountComplete={row.ownReady}
        secrets={secrets}
        secretFieldError={fieldError}
        secretFormError={formError}
        savingSmsSecrets={pendingIntent === "save-sms-secrets"}
        showInboundUrl
        inboundUrl={inboundUrl}
        smsTestFetcher={smsTestFetcher}
        testResults={testResults}
      />
    </div>
  );
}
