import { Link, useLoaderData, useActionData, useNavigation, useFetcher } from "react-router";
import { SettingsCrumb } from "~/components/SettingsCrumb";
import { useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod/v4";
import type { Route } from "./+types/settings-advanced";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { useFlash } from "~/hooks/useFlash";
import { makeStripeConnectSchema } from "~/lib/forms/settings-config.schema";
import { requireAdminLoader } from "~/lib/access.server";
import { AccessDenied } from "~/components/AccessDenied";
import { StripeConnectPanel } from "~/components/settings/advanced/StripeConnectPanel";
import { AiFeaturesPanel } from "~/components/settings/advanced/AiFeaturesPanel";
import { IntegrationKeysPanel } from "~/components/settings/advanced/IntegrationKeysPanel";
import { SectionNav } from "~/components/settings/SectionNav";
import { parseTestResults } from "~/lib/connection-test";
import { m } from "~/paraglide/messages";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface AdvancedConfig {
  stripeConnected: boolean;
  stripeAccountId?: string | null;
  geminiConfigured: boolean;
}

/* ------------------------------------------------------------------ */
/*  Loader                                                             */
/* ------------------------------------------------------------------ */

export async function loader({ request, context }: Route.LoaderArgs) {
  const { forbidden, token } = await requireAdminLoader(context, request);
  if (forbidden) return { forbidden: true as const };
  const api = createApi(context, { token });

  // Fetch Stripe connect status + secrets in parallel.
  // ai.status has no server route — omit it and default geminiConfigured to false.
  const [stripeRes, secretsRes, testResultsRes] = await Promise.all([
    api.admin["stripe-connect"].$get().catch(() => null),
    api.secrets.secrets.$get().catch(() => null),
    api.integrations["test-results"].$get().catch(() => null),
  ]);

  let stripeConnected = false;
  let stripeAccountId: string | null = null;
  if (stripeRes?.ok) {
    const body = (await stripeRes.json()) as Record<string, unknown>;
    const data = (body.data ?? {}) as Record<string, unknown>;
    stripeConnected = Boolean(data?.accountId);
    stripeAccountId = (data?.accountId as string) || null;
  }

  const secretsBody = secretsRes?.ok ? ((await secretsRes.json()) as Record<string, unknown>) : {};
  const secrets = (secretsBody.data ?? {}) as Record<string, string>;

  // Gemini is bring-your-own-key: "configured" reflects the tenant's own bound
  // key in encrypted secrets (no GET /api/ai/status route — derive from presence).
  const geminiConfigured = !!secrets.GEMINI_API_KEY;

  const testResults = await parseTestResults(testResultsRes);

  return {
    config: { stripeConnected, stripeAccountId, geminiConfigured } as AdvancedConfig,
    secrets: {
      GEMINI_API_KEY: secrets.GEMINI_API_KEY || "",
      GOOGLE_PLACES_API_KEY: secrets.GOOGLE_PLACES_API_KEY || "",
      ESTATED_API_KEY: secrets.ESTATED_API_KEY || "",
      APP_BASE_URL: secrets.APP_BASE_URL || "",
    },
    testResults,
  };
}

/* ------------------------------------------------------------------ */
/*  Action                                                             */
/* ------------------------------------------------------------------ */

export async function action({ request, context }: Route.ActionArgs) {
  const token = await requireToken(context, request);
  const fd = await request.formData();
  const intent = fd.get("intent");
  const api = createApi(context, { token });

  if (intent === "connect-stripe") {
    const submission = parseWithZod(fd, { schema: makeStripeConnectSchema() });
    if (submission.status !== "success") {
      return submission.reply();
    }
    const { stripeAccountId } = submission.value;
    const res = await api.admin["stripe-connect"].$put({ json: { accountId: stripeAccountId } });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return submission.reply({
        formErrors: [(err as Record<string, string>)?.message || m.settings_advanced_stripe_connect_error()],
      });
    }
    return { success: true, error: null };
  }

  if (intent === "disconnect-stripe") {
    const res = await api.admin["stripe-connect"].$delete();
    if (!res.ok) {
      return { intent, success: false, error: m.settings_advanced_stripe_disconnect_error(), field: null, test: null };
    }
    return { intent, success: true, error: null, field: null, test: null };
  }

  if (intent === "save-ai") {
    const geminiApiKey = fd.get("GEMINI_API_KEY");
    if (!geminiApiKey || typeof geminiApiKey !== "string" || !geminiApiKey.trim()) {
      return { intent, success: false, error: m.settings_advanced_api_key_required(), field: "GEMINI_API_KEY", test: null };
    }
    const res = await api.secrets.secrets.$put({ json: { GEMINI_API_KEY: geminiApiKey } });
    if (!res.ok) {
      const errBody = (await res.json().catch(() => null)) as
        | { error?: { message?: string; field?: string } }
        | null;
      return {
        intent,
        success: false,
        error: errBody?.error?.message ?? m.settings_advanced_ai_save_error(),
        field: errBody?.error?.field ?? null,
        test: null,
      };
    }
    return { intent, success: true, error: null, field: null, test: null };
  }

  if (intent === "test-gemini") {
    const res = await api.integrations.gemini.test.$post();
    const body = (await res.json().catch(() => null)) as
      | { data?: { ok: true }; error?: { message?: string } }
      | null;
    if (!res.ok || !body?.data) {
      return {
        intent,
        success: false,
        error: body?.error?.message ?? m.settings_connection_test_failed(),
        field: null,
        test: null,
      };
    }
    return { intent, success: true, error: null, field: null, test: body.data };
  }

  if (intent === "save-advanced-secrets") {
    const body: Record<string, string> = {};
    for (const key of ["GOOGLE_PLACES_API_KEY", "ESTATED_API_KEY", "APP_BASE_URL"] as const) {
      const val = fd.get(key);
      if (val && typeof val === "string" && val.trim()) body[key] = val;
    }
    if (Object.keys(body).length > 0) {
      const res = await api.secrets.secrets.$put({ json: body });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => null)) as
          | { error?: { message?: string; field?: string } }
          | null;
        return {
          intent,
          success: false,
          error: errBody?.error?.message ?? m.settings_advanced_integration_keys_save_error(),
          field: errBody?.error?.field ?? null,
          test: null,
        };
      }
    }
    return { intent, success: true, error: null, field: null, test: null };
  }

  return { intent: null, success: false, error: m.settings_unknown_action(), field: null, test: null };
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function SettingsAdvancedPage() {
  const loaderResult = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const geminiTestFetcher = useFetcher<typeof action>();

  // Only the `connect-stripe` intent returns a Conform SubmissionResult; the
  // other intents return a `{ success, error }` flash shape. Feed Conform its
  // own result, never the flash object (which has no `initialValue`/`error`).
  const stripeResult =
    actionData && !("success" in actionData) ? actionData : undefined;
  const [stripeForm, stripeFields] = useForm({
    lastResult: stripeResult,
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: makeStripeConnectSchema() });
    },
    shouldValidate: "onBlur",
    shouldRevalidate: "onInput",
  });

  // Pending save state, per secret intent.
  const savingAi = nav.state !== "idle" && nav.formData?.get("intent") === "save-ai";
  const savingAdvanced =
    nav.state !== "idle" && nav.formData?.get("intent") === "save-advanced-secrets";

  // Transient success flash — visible for 4s after a save round-trip.
  const { flashVisible } = useFlash(
    !!actionData && "success" in actionData && !!actionData.success,
    actionData,
  );

  if ("forbidden" in loaderResult) return <AccessDenied />;
  const { config, secrets, testResults } = loaderResult;

  // Map a server `field` error back onto the matching SecretField.
  const secretFieldError = (name: string): string | undefined => {
    if (
      actionData &&
      "field" in actionData &&
      actionData.field === name &&
      "success" in actionData &&
      !actionData.success
    ) {
      return actionData.error ?? undefined;
    }
    return undefined;
  };

  const navSections = [
    { id: "stripe-connect", label: m.settings_stripeconnect_heading() },
    { id: "ai-features", label: m.settings_ai_heading() },
    { id: "integration-keys", label: m.settings_intkeys_heading() },
    { id: "data", label: m.settings_advanced_data_heading() },
  ];

  return (
    <div className="space-y-ih-list max-w-3xl">
      <SettingsCrumb items={[{ label: m.settings_crumb_root(), href: "/settings" }, { label: m.settings_advanced_crumb() }]} />
      <p className="text-[13px] text-ih-fg-3">{m.settings_advanced_intro()}</p>

      {/* Flash */}
      {flashVisible && actionData && "success" in actionData && actionData.success && (
        <div className="px-4 py-2.5 rounded-md bg-ih-ok-bg border border-ih-ok-fg/20 text-[13px] text-ih-ok-fg font-medium">
          {m.settings_flash_saved()}
        </div>
      )}
      {actionData &&
      "error" in actionData &&
      typeof actionData.error === "string" &&
      actionData.error &&
      !("field" in actionData && actionData.field) ? (
        <div className="px-4 py-2.5 rounded-md bg-ih-bad-bg border border-ih-bad text-[13px] text-ih-bad-fg font-medium">
          {actionData.error}
        </div>
      ) : null}

      {/* In-page section navigation (sticky; scroll-spy). Shows only when ≥3 sections visible. */}
      <SectionNav sections={navSections} />

      {/* Stripe Connect */}
      <div id="stripe-connect" className="scroll-mt-12">
        <StripeConnectPanel
          stripeConnected={config.stripeConnected}
          stripeAccountId={config.stripeAccountId}
          stripeForm={stripeForm}
          stripeFields={stripeFields}
        />
      </div>

      {/* AI features */}
      <div id="ai-features" className="scroll-mt-12">
        <AiFeaturesPanel
          geminiConfigured={config.geminiConfigured}
          value={secrets.GEMINI_API_KEY}
          fieldError={secretFieldError}
          saving={savingAi}
          geminiTestFetcher={geminiTestFetcher}
          testResults={testResults}
        />
      </div>

      {/* Integration API keys */}
      <div id="integration-keys" className="scroll-mt-12">
        <IntegrationKeysPanel
          secrets={{
            GOOGLE_PLACES_API_KEY: secrets.GOOGLE_PLACES_API_KEY,
            ESTATED_API_KEY: secrets.ESTATED_API_KEY,
            APP_BASE_URL: secrets.APP_BASE_URL,
          }}
          fieldError={secretFieldError}
          saving={savingAdvanced}
        />
      </div>

      {/* Data import/export */}
      <section id="data" className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-5 scroll-mt-12">
        <h3 className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">{m.settings_advanced_data_heading()}</h3>
        <p className="text-[13px] text-ih-fg-3">
          {m.settings_advanced_data_desc()}
        </p>
        <div className="flex flex-wrap gap-3">
          <Link to="/settings/data"
            className="h-9 px-4 rounded-md border border-ih-border bg-ih-bg-card text-ih-fg-2 text-[13px] font-semibold hover:bg-ih-bg-muted transition-colors inline-flex items-center">
            {m.settings_advanced_import_export()}
          </Link>
        </div>
      </section>
    </div>
  );
}
