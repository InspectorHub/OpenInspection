import { Form, Link, useLoaderData, useActionData, useNavigation, useFetcher } from "react-router";
import { useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod/v4";
import type { Route } from "./+types/settings-advanced";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { SecretField } from "~/components/SecretField";
import { TestConnectionButton } from "~/components/settings/TestConnectionButton";
import { useFlash } from "~/hooks/useFlash";
import { stripeConnectSchema } from "~/lib/forms/settings-config.schema";
import { requireAdminLoader } from "~/lib/access.server";
import { AccessDenied } from "~/components/AccessDenied";

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
  const [stripeRes, secretsRes] = await Promise.all([
    api.admin["stripe-connect"].$get().catch(() => null),
    api.secrets.secrets.$get().catch(() => null),
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
    const res = await api.admin["stripe-connect"].$put({ json: { accountId: stripeAccountId } });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return submission.reply({
        formErrors: [(err as Record<string, string>)?.message || "Failed to connect Stripe account."],
      });
    }
    return { success: true, error: null };
  }

  if (intent === "disconnect-stripe") {
    const res = await api.admin["stripe-connect"].$delete();
    if (!res.ok) {
      return { intent, success: false, error: "Failed to disconnect Stripe account.", field: null, test: null };
    }
    return { intent, success: true, error: null, field: null, test: null };
  }

  if (intent === "save-ai") {
    const geminiApiKey = fd.get("GEMINI_API_KEY");
    if (!geminiApiKey || typeof geminiApiKey !== "string" || !geminiApiKey.trim()) {
      return { intent, success: false, error: "API key is required.", field: "GEMINI_API_KEY", test: null };
    }
    const res = await api.secrets.secrets.$put({ json: { GEMINI_API_KEY: geminiApiKey } });
    if (!res.ok) {
      const errBody = (await res.json().catch(() => null)) as
        | { error?: { message?: string; field?: string } }
        | null;
      return {
        intent,
        success: false,
        error: errBody?.error?.message ?? "Failed to save AI configuration.",
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
        error: body?.error?.message ?? "Connection test failed.",
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
          error: errBody?.error?.message ?? "Failed to save integration keys.",
          field: errBody?.error?.field ?? null,
          test: null,
        };
      }
    }
    return { intent, success: true, error: null, field: null, test: null };
  }

  return { intent: null, success: false, error: "Unknown action", field: null, test: null };
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
      return parseWithZod(formData, { schema: stripeConnectSchema });
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
  const { config, secrets } = loaderResult;

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

  const geminiTest = geminiTestFetcher.data;

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
      {flashVisible && actionData && "success" in actionData && actionData.success && (
        <div className="px-4 py-2.5 rounded-md bg-ih-ok-bg border border-ih-ok-fg/20 text-[13px] text-ih-ok-fg font-medium">
          Settings saved.
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
                className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none transition-all font-mono text-[13px] placeholder:text-ih-fg-4 text-ih-fg-1"
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
            error={secretFieldError("GEMINI_API_KEY")}
            hint="Powers AI comment suggestions and smart field completion. Get at aistudio.google.com/apikey"
          />
          <div className="flex justify-end pt-2 border-t border-ih-border">
            <button type="submit" disabled={savingAi}
              className="h-9 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 active:scale-[.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed">
              {savingAi ? "Saving…" : "Save"}
            </button>
          </div>
        </Form>

        {/* Test connection — probes the STORED Gemini key, no re-entry needed */}
        <TestConnectionButton fetcher={geminiTestFetcher} intent="test-gemini">
          {geminiTest && "intent" in geminiTest && geminiTest.intent === "test-gemini" && geminiTest.test && (
            <span className="text-[12px] text-ih-fg-2">Connected — key is valid</span>
          )}
          {geminiTest && "intent" in geminiTest && geminiTest.intent === "test-gemini" && "success" in geminiTest && !geminiTest.success && (
            <span className="text-[12px] text-ih-bad-fg">{geminiTest.error}</span>
          )}
        </TestConnectionButton>
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
            error={secretFieldError("GOOGLE_PLACES_API_KEY")}
            hint="Address autocomplete on booking and new inspection forms. Create at console.cloud.google.com → Places API"
          />
          <SecretField
            name="ESTATED_API_KEY"
            label="Estated API key"
            value={secrets.ESTATED_API_KEY}
            error={secretFieldError("ESTATED_API_KEY")}
            hint="Auto-fills Property Facts (year built, sqft, bedrooms). Get at estated.com → API"
          />
          <SecretField
            name="APP_BASE_URL"
            label="Application base URL"
            value={secrets.APP_BASE_URL}
            type="text"
            error={secretFieldError("APP_BASE_URL")}
            hint="Public URL of your deployment (e.g. https://app.yourdomain.com). Used in email links"
          />
          <div className="flex justify-end pt-2 border-t border-ih-border">
            <button type="submit" disabled={savingAdvanced}
              className="h-9 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 active:scale-[.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed">
              {savingAdvanced ? "Saving…" : "Save"}
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
