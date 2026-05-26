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
  const body = res.ok ? ((await res.json()) as Record<string, unknown>) : {};
  return { account: (body.data ?? {}) as AccountInfo };
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
      <div className="flex items-center gap-2 text-[13px] text-ih-fg-3">
        <Link to="/settings" className="hover:text-ih-primary transition-colors">Settings</Link>
        <span>&rsaquo;</span>
        <span className="text-ih-fg-1">Account</span>
      </div>
      <h2 className="text-[19px] font-bold text-ih-fg-1">Account</h2>
      <p className="text-[13px] text-ih-fg-3">Account information, data export, and account deletion.</p>

      {/* Flash */}
      {actionData?.success && (
        <div className="px-4 py-2.5 rounded-md bg-ih-ok-bg border border-ih-ok-fg/20 text-[13px] text-ih-ok-fg font-medium">
          {(actionData as Record<string, unknown>).message as string || "Done."}
        </div>
      )}
      {actionData?.error && (
        <div className="px-4 py-2.5 rounded-md bg-ih-bad-bg border border-ih-bad text-[13px] text-ih-bad-fg font-medium">
          {actionData.error}
        </div>
      )}

      {/* Account info */}
      <section className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-4">
        <h3 className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">Account details</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-4 mb-1">Email</p>
            <p className="text-[13px] text-ih-fg-1 font-medium">{account.email || "Not set"}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-4 mb-1">Name</p>
            <p className="text-[13px] text-ih-fg-1 font-medium">{account.name || "Not set"}</p>
          </div>
        </div>
      </section>

      {/* Data export */}
      <section className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-4">
        <h3 className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">Data export</h3>
        <p className="text-[13px] text-ih-fg-3">
          Download a copy of all your data including inspections, reports, templates, and client information.
        </p>
        <Form method="post">
          <input type="hidden" name="intent" value="export-data" />
          <button type="submit"
            className="h-9 px-4 rounded-md border border-ih-border bg-ih-bg-card text-ih-fg-2 text-[13px] font-semibold hover:bg-ih-bg-muted transition-colors">
            Download my data
          </button>
        </Form>
      </section>

      {/* Danger zone */}
      <section className="bg-ih-bg-card rounded-lg border border-ih-bad p-6 space-y-4">
        <h3 className="text-[11px] font-bold text-ih-bad-fg uppercase tracking-[0.2em]">Danger zone</h3>
        <div className="p-4 rounded-md bg-ih-bad-bg border border-ih-bad">
          <p className="text-[13px] font-bold text-ih-bad-fg mb-1">Delete account</p>
          <p className="text-[12px] text-ih-bad-fg leading-relaxed">
            Permanently delete your account and all associated data including inspections,
            reports, templates, and client records. This action cannot be undone.
          </p>
        </div>

        {!showDeleteConfirm ? (
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            className="h-9 px-4 rounded-md border border-ih-bad text-ih-bad-fg text-[13px] font-bold hover:bg-ih-bad-bg transition-colors"
          >
            Delete my account
          </button>
        ) : (
          <Form method="post" className="space-y-3 max-w-sm">
            <input type="hidden" name="intent" value="delete-account" />
            <div className="space-y-2">
              <label htmlFor="deletePassword" className="block text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">
                Enter your password to confirm
              </label>
              <input
                type="password" id="deletePassword" name="password" required
                autoComplete="current-password"
                className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-bad focus:shadow-ih-focus outline-none text-[13px] text-ih-fg-1"
              />
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setShowDeleteConfirm(false)}
                className="h-9 px-3 rounded-md border border-ih-border text-[13px] font-medium text-ih-fg-2 hover:bg-ih-bg-muted transition-colors">
                Cancel
              </button>
              <button type="submit"
                className="h-9 px-4 rounded-md bg-rose-600 text-white font-bold text-[13px] hover:bg-ih-bad-fg active:scale-[.98] transition-all">
                Permanently delete
              </button>
            </div>
          </Form>
        )}
      </section>
    </div>
  );
}
