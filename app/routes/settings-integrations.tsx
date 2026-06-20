import { useState } from "react";
import {
  Link,
  useLoaderData,
  useActionData,
  useNavigation,
  useRevalidator,
  useFetcher,
  Form,
} from "react-router";
import type { Route } from "./+types/settings-integrations";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { SecretField } from "~/components/SecretField";
import { TestConnectionButton } from "~/components/settings/TestConnectionButton";
import { useFlash } from "~/hooks/useFlash";
import { useSessionContext } from "~/hooks/useSessionContext";
import { requireAdminLoader } from "~/lib/access.server";
import { AccessDenied } from "~/components/AccessDenied";

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

type Integration = {
  id: string;
  name: string;
  description: string;
  status: "available" | "connected";
  href?: string;
  color: string;
};

const INTEGRATIONS: Integration[] = [
  {
    id: "qbo",
    name: "QuickBooks Online",
    description: "Sync invoices, contacts, and payment status in real time.",
    status: "available" as const,
    href: "/settings/integrations/qbo",
    color: "#2CA01C",
  },
  {
    id: "gcal",
    name: "Google Calendar",
    description: "Two-way sync for inspection scheduling and availability.",
    status: "available" as const,
    color: "#4285F4",
  },
  {
    id: "google-places",
    name: "Google Places",
    description: "Address autocomplete and property data enrichment.",
    status: "available" as const,
    color: "#34A853",
  },
  {
    id: "resend",
    name: "Resend",
    description: "Transactional email delivery for reports and notifications.",
    status: "connected" as const,
    color: "#000000",
  },
  {
    id: "zapier",
    name: "Zapier",
    description: "Connect to 5,000+ apps with no-code workflows.",
    status: "available" as const,
    color: "#FF4A00",
  },
  {
    id: "gemini",
    name: "Gemini AI",
    description: "AI-powered inspection assistance and defect detection.",
    status: "available" as const,
    color: "#8E75B2",
  },
];

const STATUS_STYLES = {
  connected:
    "bg-ih-ok-bg text-ih-ok-fg",
  available:
    "bg-ih-bg-muted text-ih-fg-3",
};

/**
 * Eager-after-error prefix rules for the Stripe trio. Masked (unchanged,
 * contains •) and empty values are skipped — they mean "no change".
 */
const STRIPE_FIELD_RULES: Array<[string, RegExp, string]> = [
  ["STRIPE_PUBLISHABLE_KEY", /^pk_(test|live)_/, "Must start with pk_test_ or pk_live_."],
  ["STRIPE_SECRET_KEY", /^(sk|rk)_(test|live)_/, "Must start with sk_test_ or sk_live_."],
  ["STRIPE_WEBHOOK_SECRET", /^whsec_/, "Must start with whsec_."],
];

function validateStripeForm(fd: FormData): Record<string, string> {
  const errs: Record<string, string> = {};
  for (const [name, re, msg] of STRIPE_FIELD_RULES) {
    const v = fd.get(name);
    if (typeof v === "string" && v.trim() && !v.includes("•") && !re.test(v.trim())) {
      errs[name] = msg;
    }
  }
  return errs;
}

function WebhookResultBadge({ result }: { result: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    processed: { label: "✓ Processed", cls: "bg-ih-ok-bg text-ih-ok-fg" },
    received: { label: "✓ Received (no action)", cls: "bg-ih-bg-muted text-ih-fg-3" },
    signature_failed: { label: "✗ Signature failed — check your signing secret", cls: "bg-ih-bad-bg text-ih-bad-fg" },
    tenant_mismatch: { label: "✗ Tenant mismatch", cls: "bg-ih-bad-bg text-ih-bad-fg" },
  };
  const m = map[result] ?? { label: result, cls: "bg-ih-bg-muted text-ih-fg-3" };
  return <span className={`flex-shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold ${m.cls}`}>{m.label}</span>;
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

  // Eager-after-error client validation: validate on submit; after the first
  // failed submit, re-validate on every change inside the form.
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submittedOnce, setSubmittedOnce] = useState(false);

  if ("forbidden" in data) return <AccessDenied />;
  const { secrets, webhookBase, webhookLog } = data;

  const tenantSlug = ctx?.branding?.tenantSlug ?? null;
  const webhookUrl = tenantSlug ? `${webhookBase}/${tenantSlug}` : webhookBase;

  const saving = nav.state !== "idle" && nav.formData?.get("intent") === "save-stripe-secrets";

  const serverField = actionData?.intent === "save-stripe-secrets" && !actionData.success
    ? actionData.field
    : null;
  const fieldError = (name: string): string | undefined =>
    fieldErrors[name] ?? (serverField === name ? actionData?.error ?? undefined : undefined);

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
      <section className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-md flex items-center justify-center text-white text-[10px] font-extrabold"
            style={{ backgroundColor: "#635BFF" }}
          >
            ST
          </div>
          <div>
            <h3 className="text-[13px] font-bold text-ih-fg-1">Stripe payments</h3>
            <p className="text-[11px] text-ih-fg-3">Connect your own Stripe account to accept card payments on invoices.</p>
          </div>
        </div>

        {/* Test-mode guidance — start in the Stripe sandbox */}
        <div className="rounded-md bg-ih-bg-muted border border-ih-border px-4 py-3 text-[12px] text-ih-fg-3 leading-relaxed">
          <span className="font-semibold text-ih-fg-2">Start in test mode.</span> Use your{" "}
          <span className="font-mono">pk_test_…</span> / <span className="font-mono">sk_test_…</span> keys from{" "}
          <a href="https://dashboard.stripe.com/test/apikeys" target="_blank" rel="noopener noreferrer" className="text-ih-primary hover:underline">
            dashboard.stripe.com/test/apikeys
          </a>{" "}
          and pay with card <span className="font-mono">4242&nbsp;4242&nbsp;4242&nbsp;4242</span> (any future date / CVC) to verify the flow before going live.
        </div>

        <Form
          method="post"
          className="space-y-4 max-w-xl"
          onSubmit={(e) => {
            const errs = validateStripeForm(new FormData(e.currentTarget));
            setSubmittedOnce(true);
            setFieldErrors(errs);
            if (Object.keys(errs).length > 0) e.preventDefault();
          }}
          onChange={(e) => {
            if (submittedOnce) {
              setFieldErrors(validateStripeForm(new FormData(e.currentTarget)));
            }
          }}
        >
          <input type="hidden" name="intent" value="save-stripe-secrets" />
          <SecretField
            name="STRIPE_PUBLISHABLE_KEY"
            label="Publishable Key"
            value={secrets.STRIPE_PUBLISHABLE_KEY}
            error={fieldError("STRIPE_PUBLISHABLE_KEY")}
            hint="Sent to the browser to render the card field. Starts with pk_test_ (test) or pk_live_ (live)."
          />
          <SecretField
            name="STRIPE_SECRET_KEY"
            label="Secret Key"
            value={secrets.STRIPE_SECRET_KEY}
            error={fieldError("STRIPE_SECRET_KEY")}
            hint="Server-side key that creates the charge. Starts with sk_test_ or sk_live_. Never shared with the browser."
          />
          <SecretField
            name="STRIPE_WEBHOOK_SECRET"
            label="Webhook Signing Secret"
            value={secrets.STRIPE_WEBHOOK_SECRET}
            error={fieldError("STRIPE_WEBHOOK_SECRET")}
            hint="Verifies payment notifications. Found after you add the webhook endpoint below (starts with whsec_)."
          />
          <div className="flex justify-end pt-2 border-t border-ih-border">
            <button type="submit" disabled={saving}
              className="h-9 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 active:scale-[.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed">
              {saving ? "Saving…" : "Save Stripe keys"}
            </button>
          </div>
        </Form>

        {/* Test connection — probes the STORED secret key, no re-entry needed */}
        <TestConnectionButton fetcher={testFetcher} intent="test-stripe">
          {testFetcher.data?.intent === "test-stripe" && testFetcher.data.test && (
            <span className="text-[12px] text-ih-fg-2">
              Connected: <span className="font-semibold">{testFetcher.data.test.accountName}</span>
              <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest ${
                testFetcher.data.test.livemode
                  ? "bg-ih-bad-bg text-ih-bad-fg"
                  : "bg-ih-ok-bg text-ih-ok-fg"
              }`}>
                {testFetcher.data.test.livemode ? "Live" : "Test"}
              </span>
            </span>
          )}
          {testFetcher.data?.intent === "test-stripe" && !testFetcher.data.success && (
            <span className="text-[12px] text-ih-bad-fg">{testFetcher.data.error}</span>
          )}
        </TestConnectionButton>

        {/* Webhook endpoint to register in the Stripe dashboard */}
        <div className="pt-1 space-y-1.5">
          <p className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.14em]">Webhook endpoint</p>
          <p className="text-[12px] text-ih-fg-3 leading-relaxed">
            In Stripe → Developers → Webhooks, add an endpoint for the{" "}
            <span className="font-semibold text-ih-fg-2">payment_intent.succeeded</span> event pointing at this URL, then paste its signing secret above.
            If you registered an endpoint before, re-point it to this URL — the signing secret stays the same.
          </p>
          <code className="block w-full px-3 py-2 rounded-md bg-ih-bg-muted border border-ih-border text-[12px] font-mono text-ih-fg-1 break-all select-all">
            {webhookUrl}
          </code>
        </div>

        {/* Recent webhook deliveries — diagnostics log */}
        <div className="pt-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.14em]">Recent webhook deliveries</p>
            <button type="button" onClick={() => revalidator.revalidate()}
              disabled={revalidator.state !== "idle"}
              className="h-7 px-2.5 rounded-md border border-ih-border bg-ih-bg-card text-[11px] font-bold text-ih-fg-2 hover:bg-ih-bg-muted transition-colors disabled:opacity-60">
              {revalidator.state !== "idle" ? "Refreshing…" : "Refresh"}
            </button>
          </div>
          {webhookLog.length === 0 ? (
            <p className="text-[12px] text-ih-fg-3 leading-relaxed">
              No deliveries yet. In Stripe → Developers → Webhooks → your endpoint, click{" "}
              <span className="font-semibold text-ih-fg-2">Send test event</span>, then hit Refresh.
            </p>
          ) : (
            <ul className="divide-y divide-ih-border rounded-md border border-ih-border bg-ih-bg-card">
              {webhookLog.map((e, i) => (
                <li key={`${e.ts}-${i}`} className="flex items-center justify-between px-3 py-2 text-[12px]">
                  <span className="text-ih-fg-3 tabular-nums flex-shrink-0">{new Date(e.ts).toLocaleString()}</span>
                  <span className="font-mono text-ih-fg-2 truncate mx-3 flex-1">{e.eventType}</span>
                  <WebhookResultBadge result={e.result} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {INTEGRATIONS.map((i) => (
          <div
            key={i.id}
            className="bg-ih-bg-card border border-ih-border rounded-lg p-5 flex flex-col gap-3"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div
                  className="w-8 h-8 rounded-md flex items-center justify-center text-white text-[10px] font-extrabold"
                  style={{ backgroundColor: i.color }}
                >
                  {i.name.slice(0, 2).toUpperCase()}
                </div>
                <h3 className="text-[13px] font-bold text-ih-fg-1">
                  {i.name}
                </h3>
              </div>
              <span
                className={`flex-shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest ${STATUS_STYLES[i.status]}`}
              >
                {i.status === "connected" ? "Connected" : "Available"}
              </span>
            </div>
            <p className="text-[12px] text-ih-fg-3 leading-relaxed flex-1">
              {i.description}
            </p>
            {i.href ? (
              <Link
                to={i.href}
                className="self-start px-3 h-7 rounded-md border border-ih-border bg-ih-bg-card text-[12px] font-bold text-ih-fg-2 hover:bg-ih-bg-muted transition-colors inline-flex items-center"
              >
                {i.status === "connected" ? "Configure" : "Connect"}
              </Link>
            ) : (
              <button
                disabled
                className="self-start px-3 h-7 rounded-md border border-ih-border bg-ih-bg-card text-[12px] font-bold text-ih-fg-2 opacity-50 cursor-not-allowed inline-flex items-center"
              >
                {i.status === "connected" ? "Configure" : "Connect"}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
