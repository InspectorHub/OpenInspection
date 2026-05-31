import { Form, Link, useLoaderData, useActionData } from "react-router";
import { useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod/v4";
import type { Route } from "./+types/settings-advanced";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { SecretField } from "~/components/SecretField";
import { stripeConnectSchema } from "~/lib/forms/settings-config.schema";

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
  const token = await requireToken(context, request);
  const api = createApi(context, { token });

  // Fetch Stripe connect status + secrets in parallel
  const [stripeRes, aiRes, secretsRes] = await Promise.all([
    api.admin.payments.status.$get().catch(() => null),
    api.admin.ai.status.$get().catch(() => null),
    api.admin.secrets.$get().catch(() => null),
  ]);

  let stripeConnected = false;
  let stripeAccountId: string | null = null;
  if (stripeRes?.ok) {
    const body = (await stripeRes.json()) as Record<string, unknown>;
    const data = (body.data ?? {}) as Record<string, unknown>;
    stripeConnected = Boolean(data?.connected);
    stripeAccountId = (data?.accountId as string) || null;
  }

  let geminiConfigured = false;
  if (aiRes?.ok) {
    const body = (await aiRes.json()) as Record<string, unknown>;
    const data = (body.data ?? {}) as Record<string, unknown>;
    geminiConfigured = Boolean(data?.configured);
  }

  const secretsBody = secretsRes?.ok ? ((await secretsRes.json()) as Record<string, unknown>) : {};
  const secrets = (secretsBody.data ?? {}) as Record<string, string>;

  return {
    config: { stripeConnected, stripeAccountId, geminiConfigured } as AdvancedConfig,
    secrets: {
      GEMINI_API_KEY: secrets.GEMINI_API_KEY || "",
      GOOGLE_PLACES_API_KEY: secrets.GOOGLE_PLACES_API_KEY || "",
      ESTATED_API_KEY: secrets.ESTATED_API_KEY || "",
      APP_BASE_URL: secrets.APP_BASE_URL || "",
    },
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
    const submission = parseWithZod(fd, { schema: stripeConnectSchema });
    if (submission.status !== "success") {
      return submission.reply();
    }
    const { stripeAccountId } = submission.value;
    const res = await api.admin.payments.connect.$post({ json: { accountId: stripeAccountId } });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return submission.reply({
        formErrors: [(err as Record<string, string>)?.message || "Failed to connect Stripe account."],
      });
    }
    return { success: true, error: null };
  }

  if (intent === "disconnect-stripe") {
    const res = await api.admin.payments.disconnect.$post();
    if (!res.ok) {
      return { success: false, error: "Failed to disconnect Stripe account." };
    }
    return { success: true, error: null };
  }

  if (intent === "save-ai") {
    const geminiApiKey = fd.get("GEMINI_API_KEY");
    if (!geminiApiKey || typeof geminiApiKey !== "string" || !geminiApiKey.trim()) {
      return { success: false, error: "API key is required." };
    }
    const res = await api.admin.secrets.$put({ json: { GEMINI_API_KEY: geminiApiKey } });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { success: false, error: (err as Record<string, string>)?.message || "Failed to save AI configuration." };
    }
    return { success: true, error: null };
  }

  if (intent === "save-advanced-secrets") {
    const body: Record<string, string> = {};
    for (const key of ["GOOGLE_PLACES_API_KEY", "ESTATED_API_KEY", "APP_BASE_URL"] as const) {
      const val = fd.get(key);
      if (val && typeof val === "string" && val.trim()) body[key] = val;
    }
    if (Object.keys(body).length > 0) {
      const res = await api.admin.secrets.$put({ json: body });
      if (!res.ok) {
        return { success: false, error: "Failed to save integration keys." };
      }
    }
    return { success: true, error: null };
  }

  return { success: false, error: "Unknown action" };
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function SettingsAdvancedPage() {
  const { config, secrets } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  // Only the `connect-stripe` intent returns a Conform SubmissionResult; the
  // other intents return a `{ success, error }` flash shape. Feed Conform its
  // own result, never the flash object (which has no `initialValue`/`error`).
  const stripeResult =
    actionData && !("success" in actionData) ? actionData : undefined;
  const [stripeForm, stripeFields] = useForm({
    lastResult: stripeResult,
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: stripeConnectSchema });
    },
    shouldValidate: "onBlur",
    shouldRevalidate: "onInput",
  });

  return (
    <div className="space-y-[18px] max-w-3xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-[13px] text-ih-fg-3">
        <Link to="/settings" className="hover:text-ih-primary transition-colors">Settings</Link>
        <span>&rsaquo;</span>
        <span className="text-ih-fg-1">Advanced</span>
      </div>
      <h2 className="text-[19px] font-bold text-ih-fg-1">Advanced</h2>
      <p className="text-[13px] text-ih-fg-3">Stripe payments, AI features, and integrations.</p>

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

      {/* Stripe Connect */}
      <section className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-5">
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">Payments (Stripe Connect)</h3>
          <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ${
 config.stripeConnected
 ? "bg-ih-ok-bg text-ih-ok-fg"
 : "bg-ih-bg-muted text-ih-fg-3"
 }`}>
            {config.stripeConnected ? "Connected" : "Not connected"}
          </span>
        </div>
        <p className="text-[13px] text-ih-fg-3">
          Accept card payments on invoices via your Stripe Express account. Create your account at{" "}
          <a href="https://dashboard.stripe.com/connect/express" target="_blank" rel="noopener noreferrer"
            className="text-ih-primary hover:underline">
            dashboard.stripe.com/connect/express
          </a>, then paste the account ID below.
        </p>

        {config.stripeConnected ? (
          <div className="space-y-3">
            <div className="text-[13px] text-ih-fg-2">
              Connected account:{" "}
              <code className="font-mono text-[12px] px-2 py-1 rounded bg-ih-bg-muted text-ih-fg-1">
                {config.stripeAccountId}
              </code>
            </div>
            <Form method="post">
              <input type="hidden" name="intent" value="disconnect-stripe" />
              <button type="submit"
                className="h-9 px-4 rounded-md border border-ih-bad text-ih-bad-fg text-[13px] font-bold hover:bg-ih-bad-bg transition-colors">
                Disconnect
              </button>
            </Form>
          </div>
        ) : (
          <Form
            method="post"
            id={stripeForm.id}
            onSubmit={stripeForm.onSubmit}
            noValidate
            className="space-y-3 max-w-md"
          >
            <input type="hidden" name="intent" value="connect-stripe" />
            <div className="space-y-2">
              <label htmlFor={stripeFields.stripeAccountId.id} className="block text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">
                Stripe account ID
              </label>
              <input
                type="text"
                id={stripeFields.stripeAccountId.id}
                name={stripeFields.stripeAccountId.name}
                placeholder="acct_1AbCdEfGhIjKlMnO"
                autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
                aria-invalid={stripeFields.stripeAccountId.errors ? true : undefined}
                className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none transition-all font-mono text-[13px] placeholder:text-slate-300 dark:placeholder:text-slate-500 text-ih-fg-1"
              />
              {stripeFields.stripeAccountId.errors && (
                <p className="mt-1 text-xs text-ih-bad-fg">{stripeFields.stripeAccountId.errors[0]}</p>
              )}
            </div>
            {stripeForm.errors && (
              <div className="px-3 py-2 rounded-md bg-ih-bad-bg border border-ih-bad text-[13px] text-ih-bad-fg">
                {stripeForm.errors[0]}
              </div>
            )}
            <button type="submit"
              className="h-9 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 active:scale-[.98] transition-all">
              Connect Account
            </button>
          </Form>
        )}
      </section>

      {/* AI features */}
      <section className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-5">
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">AI features</h3>
          <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ${
 config.geminiConfigured
 ? "bg-ih-ok-bg text-ih-ok-fg"
 : "bg-ih-bg-muted text-ih-fg-3"
 }`}>
            {config.geminiConfigured ? "Configured" : "Not configured"}
          </span>
        </div>
        <p className="text-[13px] text-ih-fg-3">
          Google Gemini powers comment assist and inspection summaries. Get a key at{" "}
          <a href="https://aistudio.google.com" target="_blank" rel="noopener noreferrer"
            className="text-ih-primary hover:underline">
            aistudio.google.com
          </a>.
        </p>
        <Form method="post" className="space-y-3 max-w-xl">
          <input type="hidden" name="intent" value="save-ai" />
          <SecretField
            name="GEMINI_API_KEY"
            label="Gemini API Key"
            value={secrets.GEMINI_API_KEY}
            hint="Powers AI comment suggestions and smart field completion. Get at aistudio.google.com/apikey"
          />
          <div className="flex justify-end pt-2 border-t border-ih-border">
            <button type="submit"
              className="h-9 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 active:scale-[.98] transition-all">
              Save
            </button>
          </div>
        </Form>
      </section>

      {/* Integration API keys */}
      <section className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-5">
        <h3 className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">Integration API keys</h3>
        <p className="text-[13px] text-ih-fg-3">
          These integrations enhance the inspection workflow. All are optional — features degrade gracefully when unconfigured.
        </p>
        <Form method="post" className="space-y-4 max-w-xl">
          <input type="hidden" name="intent" value="save-advanced-secrets" />
          <SecretField
            name="GOOGLE_PLACES_API_KEY"
            label="Google Places API key"
            value={secrets.GOOGLE_PLACES_API_KEY}
            hint="Address autocomplete on booking and new inspection forms. Create at console.cloud.google.com → Places API"
          />
          <SecretField
            name="ESTATED_API_KEY"
            label="Estated API key"
            value={secrets.ESTATED_API_KEY}
            hint="Auto-fills Property Facts (year built, sqft, bedrooms). Get at estated.com → API"
          />
          <SecretField
            name="APP_BASE_URL"
            label="Application base URL"
            value={secrets.APP_BASE_URL}
            type="text"
            hint="Public URL of your deployment (e.g. https://app.yourdomain.com). Used in email links"
          />
          <div className="flex justify-end pt-2 border-t border-ih-border">
            <button type="submit"
              className="h-9 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 active:scale-[.98] transition-all">
              Save
            </button>
          </div>
        </Form>
      </section>

      {/* Data import/export */}
      <section className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-5">
        <h3 className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">Data management</h3>
        <p className="text-[13px] text-ih-fg-3">
          Import data from another inspection platform or export your data for backup.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link to="/settings/data"
            className="h-9 px-4 rounded-md border border-ih-border bg-ih-bg-card text-ih-fg-2 text-[13px] font-semibold hover:bg-ih-bg-muted transition-colors inline-flex items-center">
            Import / Export data
          </Link>
        </div>
      </section>
    </div>
  );
}
