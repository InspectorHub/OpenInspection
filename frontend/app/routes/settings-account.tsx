import { useState } from "react";
import { Form, Link, useLoaderData, useActionData } from "react-router";
import type { Route } from "./+types/settings-account";
import { requireToken } from "~/lib/session.server";
import { apiFetch } from "~/lib/api.server";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface AccountInfo {
  email?: string | null;
  name?: string | null;
  createdAt?: string | null;
}

/* ------------------------------------------------------------------ */
/*  Loader                                                             */
/* ------------------------------------------------------------------ */

export async function loader({ request }: Route.LoaderArgs) {
  const token = await requireToken(request);
  const res = await apiFetch("/api/auth/me", { token });
  const json = res.ok ? await res.json() : {};
  return { account: ((json as Record<string, unknown>)?.data || {}) as AccountInfo };
}

/* ------------------------------------------------------------------ */
/*  Action                                                             */
/* ------------------------------------------------------------------ */

export async function action({ request }: Route.ActionArgs) {
  const token = await requireToken(request);
  const fd = await request.formData();
  const intent = fd.get("intent");

  if (intent === "export-data") {
    const res = await apiFetch("/api/account/export", { token, method: "POST" });
    if (!res.ok) {
      return { success: false, error: "Data export failed. Please try again." };
    }
    return { success: true, error: null, message: "Data export initiated. You will receive a download link via email." };
  }

  if (intent === "delete-account") {
    const password = fd.get("password");
    if (!password) {
      return { success: false, error: "Password is required to delete your account." };
    }
    const res = await apiFetch("/api/account/delete", {
      token,
      method: "POST",
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { success: false, error: (err as Record<string, string>)?.message || "Account deletion failed." };
    }
    return { success: true, error: null, message: "Account deleted." };
  }

  return { success: false, error: "Unknown action" };
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function SettingsAccountPage() {
  const { account } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  return (
    <div className="space-y-[18px] max-w-3xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-[13px] text-slate-500">
        <Link to="/settings" className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">Settings</Link>
        <span>&rsaquo;</span>
        <span className="text-slate-900 dark:text-slate-100">Account</span>
      </div>
      <h2 className="text-[19px] font-bold text-slate-900 dark:text-slate-100">Account</h2>
      <p className="text-[13px] text-slate-500">Account information, data export, and account deletion.</p>

      {/* Flash */}
      {actionData?.success && (
        <div className="px-4 py-2.5 rounded-md bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-[13px] text-emerald-700 dark:text-emerald-300 font-medium">
          {(actionData as Record<string, unknown>).message as string || "Done."}
        </div>
      )}
      {actionData?.error && (
        <div className="px-4 py-2.5 rounded-md bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 text-[13px] text-rose-700 dark:text-rose-300 font-medium">
          {actionData.error}
        </div>
      )}

      {/* Account info */}
      <section className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6 space-y-4">
        <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-[0.2em]">Account details</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-1">Email</p>
            <p className="text-[13px] text-slate-900 dark:text-slate-100 font-medium">{account.email || "Not set"}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-1">Name</p>
            <p className="text-[13px] text-slate-900 dark:text-slate-100 font-medium">{account.name || "Not set"}</p>
          </div>
        </div>
      </section>

      {/* Data export */}
      <section className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6 space-y-4">
        <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-[0.2em]">Data export</h3>
        <p className="text-[13px] text-slate-600 dark:text-slate-400">
          Download a copy of all your data including inspections, reports, templates, and client information.
        </p>
        <Form method="post">
          <input type="hidden" name="intent" value="export-data" />
          <button type="submit"
            className="h-9 px-4 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 text-[13px] font-semibold hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors">
            Download my data
          </button>
        </Form>
      </section>

      {/* Danger zone */}
      <section className="bg-white dark:bg-slate-800 rounded-lg border border-rose-200 dark:border-rose-800/50 p-6 space-y-4">
        <h3 className="text-[11px] font-bold text-rose-600 dark:text-rose-400 uppercase tracking-[0.2em]">Danger zone</h3>
        <div className="p-4 rounded-md bg-rose-50 dark:bg-rose-900/10 border border-rose-100 dark:border-rose-800/30">
          <p className="text-[13px] font-bold text-rose-800 dark:text-rose-300 mb-1">Delete account</p>
          <p className="text-[12px] text-rose-700 dark:text-rose-400 leading-relaxed">
            Permanently delete your account and all associated data including inspections,
            reports, templates, and client records. This action cannot be undone.
          </p>
        </div>

        {!showDeleteConfirm ? (
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            className="h-9 px-4 rounded-md border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-400 text-[13px] font-bold hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
          >
            Delete my account
          </button>
        ) : (
          <Form method="post" className="space-y-3 max-w-sm">
            <input type="hidden" name="intent" value="delete-account" />
            <div className="space-y-2">
              <label htmlFor="deletePassword" className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-[0.2em]">
                Enter your password to confirm
              </label>
              <input
                type="password" id="deletePassword" name="password" required
                autoComplete="current-password"
                className="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 focus:border-rose-500 focus:ring-1 focus:ring-rose-500 outline-none text-[13px] text-slate-900 dark:text-slate-100"
              />
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setShowDeleteConfirm(false)}
                className="h-9 px-3 rounded-md border border-slate-200 dark:border-slate-600 text-[13px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                Cancel
              </button>
              <button type="submit"
                className="h-9 px-4 rounded-md bg-rose-600 text-white font-bold text-[13px] hover:bg-rose-700 active:scale-[.98] transition-all">
                Permanently delete
              </button>
            </div>
          </Form>
        )}
      </section>
    </div>
  );
}
