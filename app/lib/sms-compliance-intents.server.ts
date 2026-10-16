import type { createApi } from "~/lib/api-client.server";
import type { LoadContext } from "~/lib/load-context";
import { getCloudflareEnv } from "~/lib/load-context";
import { getDeploymentProfile } from "../../server/lib/deployment-profile";
import { m } from "~/paraglide/messages";

type Api = ReturnType<typeof createApi>;

/**
 * Start or redo a company's own SMS number registration, for the deployments
 * that file it on the company's behalf. Validates the business details before
 * anything is sent.
 */
export async function runComplianceIntent(
  api: Api,
  context: LoadContext,
  intent: "sms-compliance-provision" | "sms-compliance-resubmit",
  form: FormData,
) {
  const fail = (error: string, field: string | null = null) => ({ intent, ok: false as const, error, field, test: null });

  // Gate: a deployment that files the registration has to exist. The API
  // enforces this too (403 otherwise); this short-circuits a direct POST.
  // Capability, not mode (OI #308).
  if (!getDeploymentProfile(getCloudflareEnv(context)).hasManagedCompliance) {
    return fail(m.settings_comms_managed_saas_only());
  }

  const legalName = String(form.get("legalName") ?? "").trim();
  const address = String(form.get("address") ?? "").trim();
  const repName = String(form.get("repName") ?? "").trim();
  const email = String(form.get("email") ?? "").trim();
  const areaCode = String(form.get("areaCode") ?? "").trim();
  const channel: "sp10dlc" | "tollfree" = form.get("channel") === "tollfree" ? "tollfree" : "sp10dlc";

  if (!legalName) return fail(m.settings_comms_legal_name_required(), "legalName");
  if (!address) return fail(m.settings_comms_business_address_required(), "address");
  if (!repName) return fail(m.settings_comms_rep_name_required(), "repName");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(m.settings_comms_email_invalid(), "email");

  const businessInfo = {
    legalName,
    address,
    repName,
    ...(email ? { email } : {}),
    ...(areaCode ? { areaCode } : {}),
  };

  const res = await (intent === "sms-compliance-provision"
    ? api.smsAdmin.sms.compliance.provision.$post({ json: { businessInfo, channel } })
    : api.smsAdmin.sms.compliance.resubmit.$post({ json: { businessInfo, channel } }));
  if (!res.ok) {
    const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
    const msg = errBody?.error === "managed_provision_unavailable"
      ? m.settings_comms_managed_provision_unavailable()
      : errBody?.error === "managed_not_configured"
        ? m.settings_comms_managed_not_configured()
        : errBody?.error ?? (intent === "sms-compliance-provision"
          ? m.settings_comms_provision_start_failed()
          : m.settings_comms_resubmit_failed());
    return fail(msg);
  }
  return { intent, ok: true as const, error: null, field: null, test: null };
}

/** Which carrier runs the registration. */
export async function saveManagedProvider(api: Api, form: FormData) {
  const intent = "save-managed-provider";
  const managedProvider: "twilio" | "telnyx" = form.get("managedProvider") === "telnyx" ? "telnyx" : "twilio";
  const res = await api.admin["tenant-config"].$patch({ json: { managedProvider } }).catch(() => null);
  if (!res || !res.ok) {
    return { intent, ok: false as const, error: m.settings_comms_managed_provider_save_error(), field: null, test: null };
  }
  return { intent, ok: true as const, error: null, field: null, test: null };
}
