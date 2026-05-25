import { useState } from "react";
import { Form, Link, useLoaderData, useActionData } from "react-router";
import type { Route } from "./+types/settings-advanced";
import { requireToken } from "~/lib/session.server";
import { apiFetch } from "~/lib/api.server";

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

export async function loader({ request }: Route.LoaderArgs) {
  const token = await requireToken(request);

  // Fetch Stripe connect status
  let stripeConnected = false;
  let stripeAccountId: string | null = null;
  try {
    const stripeRes = await apiFetch("/api/admin/payments/status", { token });
    if (stripeRes.ok) {
      const d = (await stripeRes.json()) as Record<string, unknown>;
      const data = d.data as Record<string, unknown> | undefined;
      stripeConnected = Boolean(data?.connected);
      stripeAccountId = (data?.accountId as string) || null;
    }
  } catch { /* no-op */ }

  // Fetch AI config status
  let geminiConfigured = false;
  try {
    const aiRes = await apiFetch("/api/admin/ai/status", { token });
    if (aiRes.ok) {
      const d = (await aiRes.json()) as Record<string, unknown>;
      geminiConfigured = Boolean((d.data as Record<string, unknown>)?.configured);
    }
  } catch { /* no-op */ }

  return {
    config: { stripeConnected, stripeAccountId, geminiConfigured } as AdvancedConfig,
  };
}

/* ------------------------------------------------------------------ */
/*  Action                                                             */
/* ------------------------------------------------------------------ */

export async function action({ request }: Route.ActionArgs) {
  const token = await requireToken(request);
  const fd = await request.formData();
  const intent = fd.get("intent");

  if (intent === "connect-stripe") {
    const accountId = fd.get("stripeAccountId");
    if (!accountId || typeof accountId !== "string" || !accountId.startsWith("acct_")) {
      return { success: false, error: "Please enter a valid Stripe account ID (starts with acct_)." };
    }
    const res = await apiFetch("/api/admin/payments/connect", {
      token,
      method: "POST",
      body: JSON.stringify({ accountId }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { success: false, error: (err as Record<string, string>)?.message || "Failed to connect Stripe account." };
    }
    return { success: true, error: null };
  }

  if (intent === "disconnect-stripe") {
    const res = await apiFetch("/api/admin/payments/disconnect", {
      token,
      method: "POST",
    });
    if (!res.ok) {
      return { success: false, error: "Failed to disconnect Stripe account." };
    }
    return { success: true, error: null };
  }

  if (intent === "save-ai") {
    const geminiApiKey = fd.get("geminiApiKey");
    if (!geminiApiKey) {
      return { success: false, error: "API key is required." };
    }
    const res = await apiFetch("/api/admin/secrets", {
      token,
      method: "POST",
      body: JSON.stringify({ geminiApiKey }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { success: false, error: (err as Record<string, string>)?.message || "Failed to save AI configuration." };
    }
    return { success: true, error: null };
  }

  return { success: false, error: "Unknown action" };
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function SettingsAdvancedPage() {
  const { config } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [stripeInput, setStripeInput] = useState("");

  return (
    <div className="space-y-[18px] max-w-3xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-[13px] text-slate-500">
        <Link to="/settings" className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">Settings</Link>
        <span>&rsaquo;</span>
        <span className="text-slate-900 dark:text-slate-100">Advanced</span>
      </div>
      <h2 className="text-[19px] font-bold text-slate-900 dark:text-slate-100">Advanced</h2>
      <p className="text-[13px] text-slate-500">Stripe payments, AI features, and integrations.</p>

      {/* Flash */}
      {actionData?.success && (
        <div className="px-4 py-2.5 rounded-md bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-[13px] text-emerald-700 dark:text-emerald-300 font-medium">
          Settings saved.
        </div>
      )}
      {actionData?.error && (
        <div className="px-4 py-2.5 rounded-md bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 text-[13px] text-rose-700 dark:text-rose-300 font-medium">
          {actionData.error}
        </div>
      )}

      {/* Stripe Connect */}
      <section className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6 space-y-5">
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-[0.2em]">Payments (Stripe Connect)</h3>
          <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ${
            config.stripeConnected
              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400"
              : "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400"
          }`}>
            {config.stripeConnected ? "Connected" : "Not connected"}
          </span>
        </div>
        <p className="text-[13px] text-slate-600 dark:text-slate-400">
          Accept card payments on invoices via your Stripe Express account. Create your account at{" "}
          <a href="https://dashboard.stripe.com/connect/express" target="_blank" rel="noopener noreferrer"
            className="text-indigo-600 dark:text-indigo-400 hover:underline">
            dashboard.stripe.com/connect/express
          </a>, then paste the account ID below.
        </p>

        {config.stripeConnected ? (
          <div className="space-y-3">
            <div className="text-[13px] text-slate-700 dark:text-slate-300">
              Connected account:{" "}
              <code className="font-mono text-[12px] px-2 py-1 rounded bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-slate-100">
                {config.stripeAccountId}
              </code>
            </div>
            <Form method="post">
              <input type="hidden" name="intent" value="disconnect-stripe" />
              <button type="submit"
                className="h-9 px-4 rounded-md border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-400 text-[13px] font-bold hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors">
                Disconnect
              </button>
            </Form>
          </div>
        ) : (
          <Form method="post" className="space-y-3 max-w-md">
            <input type="hidden" name="intent" value="connect-stripe" />
            <div className="space-y-2">
              <label htmlFor="stripeAccountId" className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-[0.2em]">
                Stripe account ID
              </label>
              <input
                type="text" id="stripeAccountId" name="stripeAccountId"
                value={stripeInput} onChange={(e) => setStripeInput(e.target.value)}
                placeholder="acct_1AbCdEfGhIjKlMnO"
                autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
                className="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all font-mono text-[13px] placeholder:text-slate-300 dark:placeholder:text-slate-500 text-slate-900 dark:text-slate-100"
              />
            </div>
            <button type="submit"
              className="h-9 px-4 rounded-md bg-indigo-600 text-white font-bold text-[13px] hover:bg-indigo-700 active:scale-[.98] transition-all">
              Connect Account
            </button>
          </Form>
        )}
      </section>

      {/* AI features */}
      <section className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6 space-y-5">
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-[0.2em]">AI features</h3>
          <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ${
            config.geminiConfigured
              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400"
              : "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400"
          }`}>
            {config.geminiConfigured ? "Configured" : "Not configured"}
          </span>
        </div>
        <p className="text-[13px] text-slate-600 dark:text-slate-400">
          Google Gemini powers comment assist and inspection summaries. Get a key at{" "}
          <a href="https://aistudio.google.com" target="_blank" rel="noopener noreferrer"
            className="text-indigo-600 dark:text-indigo-400 hover:underline">
            aistudio.google.com
          </a>.
        </p>
        <Form method="post" className="space-y-3 max-w-xl">
          <input type="hidden" name="intent" value="save-ai" />
          <div className="space-y-2">
            <label htmlFor="geminiApiKey" className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-[0.2em]">
              Gemini API Key
            </label>
            <input
              type="password" id="geminiApiKey" name="geminiApiKey"
              placeholder="AIza..."
              autoComplete="off"
              className="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all font-medium text-[13px] placeholder:text-slate-300 dark:placeholder:text-slate-500 text-slate-900 dark:text-slate-100"
            />
            <p className="text-[11px] text-slate-500">Stored encrypted. Leave blank to keep existing key.</p>
          </div>
          <div className="flex justify-end pt-2 border-t border-slate-200 dark:border-slate-700">
            <button type="submit"
              className="h-9 px-4 rounded-md bg-indigo-600 text-white font-bold text-[13px] hover:bg-indigo-700 active:scale-[.98] transition-all">
              Save
            </button>
          </div>
        </Form>
      </section>

      {/* Data import/export */}
      <section className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6 space-y-5">
        <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-[0.2em]">Data management</h3>
        <p className="text-[13px] text-slate-600 dark:text-slate-400">
          Import data from another inspection platform or export your data for backup.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link to="/settings/data"
            className="h-9 px-4 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 text-[13px] font-semibold hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors inline-flex items-center">
            Import / Export data
          </Link>
        </div>
      </section>
    </div>
  );
}
