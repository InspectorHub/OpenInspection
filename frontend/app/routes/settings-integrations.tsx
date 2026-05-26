import { Link, useLoaderData, useActionData, Form } from "react-router";
import type { Route } from "./+types/settings-integrations";
import { requireToken } from "~/lib/session.server";
import { apiFetch } from "~/lib/api.server";
import { SecretField } from "~/components/SecretField";

export function meta() {
  return [{ title: "Integrations - Settings - OpenInspection" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const token = await requireToken(request);
  const secretsRes = await apiFetch("/api/admin/secrets", { token }).catch(() => null);
  const secretsBody = secretsRes?.ok ? ((await secretsRes.json()) as Record<string, unknown>) : {};
  const secrets = (secretsBody.data ?? {}) as Record<string, string>;
  return {
    secrets: {
      STRIPE_SECRET_KEY: secrets.STRIPE_SECRET_KEY || "",
      STRIPE_WEBHOOK_SECRET: secrets.STRIPE_WEBHOOK_SECRET || "",
    },
  };
}

export async function action({ request }: Route.ActionArgs) {
  const token = await requireToken(request);
  const fd = await request.formData();
  const intent = fd.get("intent");

  if (intent === "save-stripe-secrets") {
    const body: Record<string, string> = {};
    for (const key of ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"] as const) {
      const val = fd.get(key);
      if (val && typeof val === "string" && val.trim()) body[key] = val;
    }
    if (Object.keys(body).length > 0) {
      const res = await apiFetch("/api/admin/secrets", {
        token,
        method: "PUT",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        return { success: false, error: "Failed to save Stripe keys." };
      }
    }
    return { success: true, error: null };
  }

  return { success: false, error: "Unknown action" };
}

const INTEGRATIONS = [
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
    id: "stripe",
    name: "Stripe",
    description: "Accept online payments and manage billing.",
    status: "available" as const,
    color: "#635BFF",
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
    "bg-emerald-50 dark:bg-emerald-900/30 text-ih-ok-fg",
  available:
    "bg-ih-bg-muted text-ih-fg-3",
};

export default function SettingsIntegrations() {
  const { secrets } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

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
      {actionData?.success && (
        <div className="px-4 py-2.5 rounded-md bg-ih-ok-bg border border-ih-ok-fg/20 text-[13px] text-ih-ok-fg font-medium">
          Settings saved.
        </div>
      )}
      {actionData?.error && (
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
            <h3 className="text-[13px] font-bold text-ih-fg-1">Stripe API keys</h3>
            <p className="text-[11px] text-ih-fg-3">Required for payment processing. Get keys at dashboard.stripe.com/apikeys.</p>
          </div>
        </div>
        <Form method="post" className="space-y-4 max-w-xl">
          <input type="hidden" name="intent" value="save-stripe-secrets" />
          <SecretField
            name="STRIPE_SECRET_KEY"
            label="Stripe Secret Key"
            value={secrets.STRIPE_SECRET_KEY}
            hint="Enables online payment for inspections. Get at dashboard.stripe.com → Developers → API Keys"
          />
          <SecretField
            name="STRIPE_WEBHOOK_SECRET"
            label="Stripe Webhook Secret"
            value={secrets.STRIPE_WEBHOOK_SECRET}
            hint="Verifies payment event notifications. Found at dashboard.stripe.com → Developers → Webhooks → Signing secret"
          />
          <div className="flex justify-end pt-2 border-t border-ih-border">
            <button type="submit"
              className="h-9 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 active:scale-[.98] transition-all">
              Save Stripe keys
            </button>
          </div>
        </Form>
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
