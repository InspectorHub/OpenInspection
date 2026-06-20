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
import { IntegrationCardsGrid } from "~/components/settings/integrations/IntegrationCardsGrid";

export function meta() {
  return [{ title: "Integrations - Settings - OpenInspection" }];
}

type WebhookLogEntry = { ts: string; eventType: string; result: string };

export async function loader({ request, context }: Route.LoaderArgs) {
  const { forbidden, token } = await requireAdminLoader(context, request);
  if (forbidden) return { forbidden: true as const };
  const api = createApi(context, { token });
  const [secretsRes, logRes] = await Promise.all([
    api.secrets.secrets.$get().catch(() => null),
    api.integrations.stripe["webhook-log"].$get().catch(() => null),
  ]);
  const secretsBody = secretsRes?.ok ? ((await secretsRes.json()) as Record<string, unknown>) : {};
  const secrets = (secretsBody.data ?? {}) as Record<string, string>;
  const logBody = logRes?.ok ? ((await logRes.json()) as Record<string, unknown>) : {};
  const webhookLog = (logBody.data ?? []) as WebhookLogEntry[];
  const webhookBase = `${new URL(request.url).origin}/api/integrations/stripe/webhook`;
  return {
    webhookBase,
    webhookLog,
    secrets: {
      STRIPE_PUBLISHABLE_KEY: secrets.STRIPE_PUBLISHABLE_KEY || "",
      STRIPE_SECRET_KEY: secrets.STRIPE_SECRET_KEY || "",
      STRIPE_WEBHOOK_SECRET: secrets.STRIPE_WEBHOOK_SECRET || "",
    },
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

  return { intent: null, success: false, error: "Unknown action", field: null, test: null };
}

export default function SettingsIntegrations() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const revalidator = useRevalidator();
  const testFetcher = useFetcher<typeof action>();
  const ctx = useSessionContext();

  // Transient success flash — visible for 4s after a save round-trip.
  // Errors persist until the next attempt (no auto-dismiss).
  const { flashVisible } = useFlash(
    actionData?.intent === "save-stripe-secrets" && !!actionData.success,
    actionData,
  );

  if ("forbidden" in data) return <AccessDenied />;
  const { secrets, webhookBase, webhookLog } = data;

  const tenantSlug = ctx?.branding?.tenantSlug ?? null;
  const webhookUrl = tenantSlug ? `${webhookBase}/${tenantSlug}` : webhookBase;

  const saving = nav.state !== "idle" && nav.formData?.get("intent") === "save-stripe-secrets";

  const serverField = actionData?.intent === "save-stripe-secrets" && !actionData.success
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

      {/* Flash */}
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
      />

      <IntegrationCardsGrid />
    </div>
  );
}
