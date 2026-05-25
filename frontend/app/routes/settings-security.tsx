import { useState } from "react";
import { Form, Link, useLoaderData, useActionData } from "react-router";
import type { Route } from "./+types/settings-security";
import { requireToken } from "~/lib/session.server";
import { apiFetch } from "~/lib/api.server";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface AuthMe {
  totpEnabled?: boolean;
  recoveryCodesRemaining?: number | null;
}

/* ------------------------------------------------------------------ */
/*  Loader                                                             */
/* ------------------------------------------------------------------ */

export async function loader({ request }: Route.LoaderArgs) {
  const token = await requireToken(request);
  const res = await apiFetch("/api/auth/me", { token });
  const json = res.ok ? await res.json() : {};
  return { user: ((json as Record<string, unknown>)?.data || {}) as AuthMe };
}

/* ------------------------------------------------------------------ */
/*  Action                                                             */
/* ------------------------------------------------------------------ */

export async function action({ request }: Route.ActionArgs) {
  const token = await requireToken(request);
  const fd = await request.formData();
  const intent = fd.get("intent");

  if (intent === "change-password") {
    const body = {
      currentPassword: fd.get("currentPassword"),
      newPassword: fd.get("newPassword"),
      confirmPassword: fd.get("confirmPassword"),
    };

    if (body.newPassword !== body.confirmPassword) {
      return { success: false, error: "New passwords do not match." };
    }

    const res = await apiFetch("/api/auth/change-password", {
      token,
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { success: false, error: (err as Record<string, string>)?.message || "Password change failed" };
    }
    return { success: true, error: null };
  }

  return { success: false, error: "Unknown action" };
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function SettingsSecurityPage() {
  const { user } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="space-y-[18px] max-w-3xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-[13px] text-slate-500">
        <Link to="/settings" className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">Settings</Link>
        <span>&rsaquo;</span>
        <span className="text-slate-900 dark:text-slate-100">Security</span>
      </div>
      <h2 className="text-[19px] font-bold text-slate-900 dark:text-slate-100">Security</h2>
      <p className="text-[13px] text-slate-500">Password, two-factor authentication, and active sessions.</p>

      {/* Flash */}
      {actionData?.success && (
        <div className="px-4 py-2.5 rounded-md bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-[13px] text-emerald-700 dark:text-emerald-300 font-medium">
          Password changed successfully.
        </div>
      )}
      {actionData?.error && (
        <div className="px-4 py-2.5 rounded-md bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 text-[13px] text-rose-700 dark:text-rose-300 font-medium">
          {actionData.error}
        </div>
      )}

      {/* Change password */}
      <section className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6 space-y-5">
        <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-[0.2em]">Change password</h3>
        <Form method="post" className="space-y-4 max-w-md">
          <input type="hidden" name="intent" value="change-password" />
          <div className="space-y-2">
            <label htmlFor="currentPassword" className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-[0.2em]">Current password</label>
            <input type={showPassword ? "text" : "password"} id="currentPassword" name="currentPassword" autoComplete="current-password" required
              className="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none text-[13px] text-slate-900 dark:text-slate-100" />
          </div>
          <div className="space-y-2">
            <label htmlFor="newPassword" className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-[0.2em]">New password</label>
            <input type={showPassword ? "text" : "password"} id="newPassword" name="newPassword" autoComplete="new-password" required minLength={8}
              className="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none text-[13px] text-slate-900 dark:text-slate-100" />
          </div>
          <div className="space-y-2">
            <label htmlFor="confirmPassword" className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-[0.2em]">Confirm new password</label>
            <input type={showPassword ? "text" : "password"} id="confirmPassword" name="confirmPassword" autoComplete="new-password" required minLength={8}
              className="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none text-[13px] text-slate-900 dark:text-slate-100" />
          </div>
          <label className="flex items-center gap-2 text-[11px] text-slate-500 cursor-pointer">
            <input type="checkbox" checked={showPassword} onChange={(e) => setShowPassword(e.target.checked)}
              className="rounded border-slate-300 dark:border-slate-600" />
            Show passwords
          </label>
          <div className="flex justify-end pt-2 border-t border-slate-200 dark:border-slate-700">
            <button type="submit"
              className="px-4 py-2 bg-indigo-600 text-white rounded-md font-bold text-[13px] hover:bg-indigo-700 active:scale-[.98] transition-all">
              Change Password
            </button>
          </div>
        </Form>
      </section>

      {/* 2FA status */}
      <section className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${user.totpEnabled ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400"}`}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z" />
              </svg>
            </div>
            <div>
              <p className="font-bold text-slate-900 dark:text-slate-100 text-[13px]">Two-factor authentication</p>
              <p className="text-[11px] text-slate-600 dark:text-slate-400">
                {user.totpEnabled ? "Enabled. Required at every sign in." : "Not enabled."}
              </p>
              {user.totpEnabled && user.recoveryCodesRemaining != null && (
                <p className="text-[11px] text-slate-500 mt-1">{user.recoveryCodesRemaining} recovery codes remaining</p>
              )}
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            {!user.totpEnabled ? (
              <button className="px-4 py-2 bg-indigo-600 text-white rounded-md font-bold text-[13px] hover:bg-indigo-700 active:scale-[.98] transition-all">
                Enable 2FA
              </button>
            ) : (
              <>
                <button className="px-4 py-2 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 text-[13px] font-semibold hover:bg-slate-100 dark:hover:bg-slate-600 transition-all">
                  Regenerate codes
                </button>
                <button className="px-4 py-2 rounded-md border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-400 text-[13px] font-bold hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-all">
                  Disable 2FA
                </button>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Active sessions placeholder */}
      <section className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6 space-y-4">
        <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-[0.2em]">Active sessions</h3>
        <div className="flex items-center gap-3 p-3 rounded-md bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600">
          <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <p className="text-[13px] font-medium text-slate-900 dark:text-slate-100">Current session</p>
            <p className="text-[11px] text-slate-500">Active now</p>
          </div>
        </div>
        <p className="text-[11px] text-slate-500">Full session management coming soon.</p>
      </section>
    </div>
  );
}
