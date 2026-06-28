import {
  Link,
  useLoaderData,
  useActionData,
  useNavigation,
  useRevalidator,
  useFetcher,
} from "react-router";
import type { Route } from "./+types/settings-integrations";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { useFlash } from "~/hooks/useFlash";
import { useSessionContext } from "~/hooks/useSessionContext";
import { requireAdminLoader } from "~/lib/access.server";
import { AccessDenied } from "~/components/AccessDenied";
import { StripePaymentsPanel } from "~/components/settings/integrations/StripePaymentsPanel";
import { VideoIntegrationPanel } from "~/components/settings/integrations/VideoIntegrationPanel";
import { IntegrationCardsGrid } from "~/components/settings/integrations/IntegrationCardsGrid";
import { parseTestResults } from "~/lib/connection-test";
import { SaveVideoSchema } from "../../server/lib/validations/video.schema";

export function meta() {
  return [{ title: "Integrations - Settings - OpenInspection" }];
}

type WebhookLogEntry = { ts: string; eventType: string; result: string };

export async function loader({ request, context }: Route.LoaderArgs) {
  const { forbidden, token } = await requireAdminLoader(context, request);
  if (forbidden) return { forbidden: true as const };
  const api = createApi(context, { token });
  const [secretsRes, logRes, configRes, tcRes, testResultsRes] = await Promise.all([
    api.secrets.secrets.$get().catch(() => null),
    api.integrations.stripe["webhook-log"].$get().catch(() => null),
    // Integration config — plaintext JSON: appBaseUrl, turnstileSiteKey,
    // googleClientId, streamCustomerSubdomain.
    api.admin.config.$get().catch(() => null),
    // Tenant config flags — includes videoMode (default 'r2').
    api.admin["tenant-config"].$get().catch(() => null),
    api.integrations["test-results"].$get().catch(() => null),
  ]);
  const secretsBody = secretsRes?.ok ? ((await secretsRes.json()) as Record<string, unknown>) : {};
  const secrets = (secretsBody.data ?? {}) as Record<string, string>;
  const logBody = logRes?.ok ? ((await logRes.json()) as Record<string, unknown>) : {};
  const webhookLog = (logBody.data ?? []) as WebhookLogEntry[];
  const webhookBase = `${new URL(request.url).origin}/api/integrations/stripe/webhook`;

  const configBody = configRes?.ok
    ? ((await configRes.json()) as Record<string, unknown>)
    : {};
  const integrationConfig = (
    (configBody.data as Record<string, unknown> | undefined)?.integrationConfig ?? {}
  ) as Record<string, string>;

  const tcBody = tcRes?.ok ? ((await tcRes.json()) as Record<string, unknown>) : {};
  const tcData = (tcBody.data ?? {}) as Record<string, unknown>;

  const testResults = await parseTestResults(testResultsRes);

  return {
    webhookBase,
    webhookLog,
    testResults,
    secrets: {
      STRIPE_PUBLISHABLE_KEY: secrets.STRIPE_PUBLISHABLE_KEY || "",
      STRIPE_SECRET_KEY: secrets.STRIPE_SECRET_KEY || "",
      STRIPE_WEBHOOK_SECRET: secrets.STRIPE_WEBHOOK_SECRET || "",
    },
    videoMode: (tcData.videoMode as "r2" | "stream" | undefined) ?? "r2",
    streamCustomerSubdomain: integrationConfig.streamCustomerSubdomain ?? "",
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const token = await requireToken(context, request);
  const fd = await request.formData();
  const intent = fd.get("intent");

  if (intent === "save-stripe-secrets") {
    const body: Record<string, string> = {};
    for (const key of ["STRIPE_PUBLISHABLE_KEY", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"] as const) {
      const val = fd.get(key);
      if (val && typeof val === "string" && val.trim()) body[key] = val;
    }
    if (Object.keys(body).length > 0) {
      const api = createApi(context, { token });
      const res = await api.secrets.secrets.$put({ json: body });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => null)) as
          | { error?: { message?: string; field?: string } }
          | null;
        return {
          intent,
          success: false,
          error: errBody?.error?.message ?? "Failed to save Stripe keys.",
          field: errBody?.error?.field ?? null,
          test: null,
        };
      }
    }
    return { intent, success: true, error: null, field: null, test: null };
  }

  if (intent === "test-stripe") {
    const api = createApi(context, { token });
    const res = await api.integrations.stripe.test.$post();
    const body = (await res.json().catch(() => null)) as
      | { data?: { accountName: string; livemode: boolean }; error?: { message?: string } }
      | null;
    if (!res.ok || !body?.data) {
      return {
        intent,
        success: false,
        error: body?.error?.message ?? "Connection test failed.",
        field: null,
        test: null,
      };
    }
    return { intent, success: true, error: null, field: null, test: body.data };
  }

  if (intent === "save-video") {
    // SaaS guard: video backend is plan-managed in hosted mode.
    const bffEnv = (context as { cloudflare?: { env?: { APP_MODE?: string } } })?.cloudflare?.env;
    if (bffEnv?.APP_MODE === "saas") {
      return {
        intent,
        success: false,
        error: "Video backend is plan-managed in hosted mode.",
        field: null,
        test: null,
      };
    }

    // Validate inputs via SaveVideoSchema (replaces inline regex).
    const videoModeRaw = fd.get("videoMode");
    const subdomainRaw = ((fd.get("streamCustomerSubdomain") as string | null) ?? "").trim();
    const parseResult = SaveVideoSchema.safeParse({
      videoMode: videoModeRaw === "stream" ? "stream" : "r2",
      streamCustomerSubdomain: subdomainRaw || undefined,
    });
    if (!parseResult.success) {
      const issue = parseResult.error.issues[0];
      return {
        intent,
        success: false,
        error: issue?.message ?? "Invalid video settings.",
        field: "streamCustomerSubdomain",
        test: null,
      };
    }
    const { videoMode } = parseResult.data;

    const api = createApi(context, { token });

    // 1. GET current integrationConfig FIRST — no writes until we can do a
    //    safe read-modify-write. If the GET fails, abort with an honest error.
    const cfgRes = await api.admin.config.$get().catch(() => null);
    if (!cfgRes?.ok) {
      return {
        intent,
        success: false,
        error: "Failed to read current configuration. No changes were saved.",
        field: null,
        test: null,
      };
    }
    const cfgBody = (await cfgRes.json()) as Record<string, unknown>;
    const existing = (
      (cfgBody.data as Record<string, unknown> | undefined)?.integrationConfig ?? {}
    ) as Record<string, string | undefined>;

    // 2. Compute merged integrationConfig.
    const merged: Record<string, string | undefined> = { ...existing };
    if (videoMode === "stream") {
      // streamCustomerSubdomain is guaranteed non-empty by SaveVideoSchema
      merged.streamCustomerSubdomain = subdomainRaw;
    } else {
      // Reverting to R2: clear the subdomain so it doesn't linger.
      delete merged.streamCustomerSubdomain;
    }

    // Strip undefined values before posting (updateIntegrationConfig ignores
    // null/empty, but let's be explicit).
    const cleanMerged = Object.fromEntries(
      Object.entries(merged).filter(([, v]) => v != null && v !== ""),
    ) as Parameters<typeof api.admin.config.$post>[0]["json"];

    // 3. Write BOTH: PATCH videoMode and POST integrationConfig atomically.
    //    If either fails, surface an error — we cannot partially succeed.
    const [tcRes, postRes] = await Promise.all([
      api.admin["tenant-config"].$patch({ json: { videoMode } }),
      api.admin.config.$post({ json: cleanMerged }),
    ]);

    if (!tcRes.ok) {
      return {
        intent,
        success: false,
        error: "Failed to save video mode.",
        field: null,
        test: null,
      };
    }
    if (!postRes.ok) {
      return {
        intent,
        success: false,
        error: "Failed to save integration configuration.",
        field: null,
        test: null,
      };
    }

    return { intent, success: true, error: null, field: null, test: null };
  }

  return { intent: null, success: false, error: "Unknown action", field: null, test: null };
}

export default function SettingsIntegrations() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const revalidator = useRevalidator();
  const testFetcher = useFetcher<typeof action>();
  const ctx = useSessionContext();

  const { flashVisible } = useFlash(
    actionData?.intent === "save-stripe-secrets" && !!actionData.success,
    actionData,
  );
  const { flashVisible: videoFlashVisible } = useFlash(
    actionData?.intent === "save-video" && !!actionData.success,
    actionData,
  );

  if ("forbidden" in data) return <AccessDenied />;
  const { secrets, webhookBase, webhookLog, videoMode, streamCustomerSubdomain, testResults } = data;

  const tenantSlug = ctx?.branding?.tenantSlug ?? null;
  const webhookUrl = tenantSlug ? `${webhookBase}/${tenantSlug}` : webhookBase;
  const isSaas = ctx?.branding?.isSaas ?? false;

  const saving = nav.state !== "idle" && nav.formData?.get("intent") === "save-stripe-secrets";
  const savingVideo = nav.state !== "idle" && nav.formData?.get("intent") === "save-video";

  const serverField = actionData?.intent === "save-stripe-secrets" && !actionData.success
    ? actionData.field
    : null;
  const videoServerField = actionData?.intent === "save-video" && !actionData.success
    ? actionData.field
    : null;

  return (
    <div className="space-y-[18px]">
      <div className="flex items-center gap-2 text-[13px] text-ih-fg-3">
        <Link
          to="/settings"
          className="hover:text-ih-primary transition-colors"
        >
          Settings
        </Link>
        <span>&rsaquo;</span>
        <span className="text-ih-fg-1">Integrations</span>
      </div>

      <div>
        <h2 className="text-[19px] font-bold text-ih-fg-1">
          Integrations
        </h2>
        <p className="text-[13px] text-ih-fg-3 mt-1">
          Connect OpenInspection to your other business tools.
        </p>
      </div>

      {/* Flash — Stripe save */}
      {flashVisible && actionData?.success && (
        <div className="px-4 py-2.5 rounded-md bg-ih-ok-bg border border-ih-ok-fg/20 text-[13px] text-ih-ok-fg font-medium">
          Settings saved.
        </div>
      )}
      {actionData?.intent === "save-stripe-secrets" && actionData.error && (
        <div className="px-4 py-2.5 rounded-md bg-ih-bad-bg border border-ih-bad text-[13px] text-ih-bad-fg font-medium">
          {actionData.error}
        </div>
      )}

      {/* Flash — Video save */}
      {videoFlashVisible && actionData?.success && (
        <div className="px-4 py-2.5 rounded-md bg-ih-ok-bg border border-ih-ok-fg/20 text-[13px] text-ih-ok-fg font-medium">
          Video settings saved.
        </div>
      )}

      {/* Stripe API keys */}
      <StripePaymentsPanel
        secrets={secrets}
        webhookUrl={webhookUrl}
        webhookLog={webhookLog}
        saving={saving}
        serverField={serverField}
        serverError={actionData?.error}
        testFetcher={testFetcher}
        revalidator={revalidator}
        testResults={testResults}
      />

      {/* Video backend — self-host only; hidden in SaaS (backend is plan-gated) */}
      {!isSaas && (
        <VideoIntegrationPanel
          videoMode={videoMode}
          streamCustomerSubdomain={streamCustomerSubdomain}
          saving={savingVideo}
          serverError={actionData?.intent === "save-video" ? actionData.error : null}
          serverField={videoServerField}
        />
      )}

      <IntegrationCardsGrid />
    </div>
  );
}
