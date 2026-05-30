import { useState } from "react";
import { Form, Link, useLoaderData, useActionData } from "react-router";
import type { Route } from "./+types/settings-security";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { SecretField } from "~/components/SecretField";

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

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  const api = createApi(context, { token });

  const [meRes, secretsRes] = await Promise.all([
    api.auth.me.$get(),
    api.secrets.secrets.$get().catch(() => null),
  ]);

  const meBody = meRes.ok ? ((await meRes.json()) as Record<string, unknown>) : {};
  const secretsBody = secretsRes?.ok ? ((await secretsRes.json()) as Record<string, unknown>) : {};
  const secrets = (secretsBody.data ?? {}) as Record<string, string>;

  return {
    user: (meBody.data ?? {}) as AuthMe,
    secrets: {
      TURNSTILE_SECRET_KEY: secrets.TURNSTILE_SECRET_KEY || "",
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Action                                                             */
/* ------------------------------------------------------------------ */

export async function action({ request, context }: Route.ActionArgs) {
  const token = await requireToken(context, request);
  const api = createApi(context, { token });
  const fd = await request.formData();
  const intent = fd.get("intent");

  if (intent === "change-password") {
    const body = {
      currentPassword: String(fd.get("currentPassword") ?? ""),
      newPassword: String(fd.get("newPassword") ?? ""),
      confirmPassword: String(fd.get("confirmPassword") ?? ""),
    };

    if (body.newPassword !== body.confirmPassword) {
      return { success: false, error: "New passwords do not match." };
    }

    const res = await api.auth["change-password"].$post({
      json: body,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { success: false, error: (err as Record<string, string>)?.message || "Password change failed" };
    }
    return { success: true, error: null };
  }

  if (intent === "save-turnstile") {
    const val = fd.get("TURNSTILE_SECRET_KEY");
    if (val && typeof val === "string" && val.trim()) {
      const res = await api.secrets.secrets.$put({
        json: { TURNSTILE_SECRET_KEY: val },
      });
      if (!res.ok) {
        return { success: false, error: "Failed to save Turnstile key." };
      }
    }
    return { success: true, error: null };
  }

  return { success: false, error: "Unknown action" };
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function SettingsSecurityPage() {
  const { user, secrets } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="space-y-[18px] max-w-3xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-[13px] text-ih-fg-3">
        <Link to="/settings" className="hover:text-ih-primary transition-colors">Settings</Link>
        <span>&rsaquo;</span>
        <span className="text-ih-fg-1">Security</span>
      </div>
      <h2 className="text-[19px] font-bold text-ih-fg-1">Security</h2>
      <p className="text-[13px] text-ih-fg-3">Password, two-factor authentication, and active sessions.</p>

      {/* Flash */}
      {actionData?.success && (
        <div className="px-4 py-2.5 rounded-md bg-ih-ok-bg border border-ih-ok-fg/20 text-[13px] text-ih-ok-fg font-medium">
          Password changed successfully.
        </div>
      )}
      {actionData?.error && (
        <div className="px-4 py-2.5 rounded-md bg-ih-bad-bg border border-ih-bad text-[13px] text-ih-bad-fg font-medium">
          {actionData.error}
        </div>
      )}

      {/* Change password */}
      <section className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-5">
        <h3 className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">Change password</h3>
        <Form method="post" className="space-y-4 max-w-md">
          <input type="hidden" name="intent" value="change-password" />
          <div className="space-y-2">
            <label htmlFor="currentPassword" className="block text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">Current password</label>
            <input type={showPassword ? "text" : "password"} id="currentPassword" name="currentPassword" autoComplete="current-password" required
              className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none text-[13px] text-ih-fg-1" />
          </div>
          <div className="space-y-2">
            <label htmlFor="newPassword" className="block text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">New password</label>
            <input type={showPassword ? "text" : "password"} id="newPassword" name="newPassword" autoComplete="new-password" required minLength={8}
              className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none text-[13px] text-ih-fg-1" />
          </div>
          <div className="space-y-2">
            <label htmlFor="confirmPassword" className="block text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">Confirm new password</label>
            <input type={showPassword ? "text" : "password"} id="confirmPassword" name="confirmPassword" autoComplete="new-password" required minLength={8}
              className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none text-[13px] text-ih-fg-1" />
          </div>
          <label className="flex items-center gap-2 text-[11px] text-ih-fg-3 cursor-pointer">
            <input type="checkbox" checked={showPassword} onChange={(e) => setShowPassword(e.target.checked)}
              className="rounded border-ih-border" />
            Show passwords
          </label>
          <div className="flex justify-end pt-2 border-t border-ih-border">
            <button type="submit"
              className="px-4 py-2 bg-ih-primary text-white rounded-md font-bold text-[13px] hover:bg-ih-primary-600 active:scale-[.98] transition-all">
              Change Password
            </button>
          </div>
        </Form>
      </section>

      {/* 2FA status */}
      <section className="bg-ih-bg-card rounded-lg border border-ih-border p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${user.totpEnabled ? "bg-ih-ok-bg text-ih-ok-fg" : "bg-ih-bg-muted text-ih-fg-3"}`}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z" />
              </svg>
            </div>
            <div>
              <p className="font-bold text-ih-fg-1 text-[13px]">Two-factor authentication</p>
              <p className="text-[11px] text-ih-fg-3">
                {user.totpEnabled ? "Enabled. Required at every sign in." : "Not enabled."}
              </p>
              {user.totpEnabled && user.recoveryCodesRemaining != null && (
                <p className="text-[11px] text-ih-fg-3 mt-1">{user.recoveryCodesRemaining} recovery codes remaining</p>
              )}
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            {!user.totpEnabled ? (
              <button className="px-4 py-2 bg-ih-primary text-white rounded-md font-bold text-[13px] hover:bg-ih-primary-600 active:scale-[.98] transition-all">
                Enable 2FA
              </button>
            ) : (
              <>
                <button className="px-4 py-2 rounded-md border border-ih-border bg-ih-bg-card text-ih-fg-2 text-[13px] font-semibold hover:bg-ih-bg-muted transition-all">
                  Regenerate codes
                </button>
                <button className="px-4 py-2 rounded-md border border-ih-bad text-ih-bad-fg text-[13px] font-bold hover:bg-ih-bad-bg transition-all">
                  Disable 2FA
                </button>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Turnstile bot protection */}
      <section className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-5">
        <h3 className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">Bot protection</h3>
        <p className="text-[13px] text-ih-fg-3">
          Bot protection prevents automated form submissions on public-facing pages.
          Get keys at{" "}
          <a href="https://dash.cloudflare.com/?to=/:account/turnstile" target="_blank" rel="noopener noreferrer"
            className="text-ih-primary hover:underline">
            Cloudflare dashboard
          </a>.
        </p>
        <Form method="post" className="space-y-3 max-w-xl">
          <input type="hidden" name="intent" value="save-turnstile" />
          <SecretField
            name="TURNSTILE_SECRET_KEY"
            label="Turnstile Secret Key"
            value={secrets.TURNSTILE_SECRET_KEY}
            hint="Bot protection on booking and signup forms. Create at dash.cloudflare.com → Turnstile. Use test key 1x0000000000000000000000000000000AA for development"
          />
          <div className="flex justify-end pt-2 border-t border-ih-border">
            <button type="submit"
              className="h-9 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 active:scale-[.98] transition-all">
              Save
            </button>
          </div>
        </Form>
      </section>

      {/* Active sessions placeholder */}
      <section className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-4">
        <h3 className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">Active sessions</h3>
        <div className="flex items-center gap-3 p-3 rounded-md bg-ih-bg-muted border border-ih-border">
          <div className="w-8 h-8 rounded-full bg-ih-primary-tint text-ih-primary flex items-center justify-center">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <p className="text-[13px] font-medium text-ih-fg-1">Current session</p>
            <p className="text-[11px] text-ih-fg-3">Active now</p>
          </div>
        </div>
        <p className="text-[11px] text-ih-fg-3">Full session management coming soon.</p>
      </section>
    </div>
  );
}
