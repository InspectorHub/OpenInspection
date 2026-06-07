import { useState, useEffect } from "react";
import { Form, Link, useLoaderData, useActionData, useNavigation } from "react-router";
import { useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod/v4";
import type { Route } from "./+types/settings-security";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { SecretField } from "~/components/SecretField";
import { changePasswordSchema, deleteAccountSchema } from "~/lib/forms/settings.schema";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface AuthMe {
  totpEnabled?: boolean;
  recoveryCodesRemaining?: number | null;
  email?: string | null;
  name?: string | null;
  createdAt?: string | null;
}

/* ------------------------------------------------------------------ */
/*  Loader                                                             */
/* ------------------------------------------------------------------ */

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  const api = createApi(context, { token });

  const [meRes, secretsRes] = await Promise.all([
    // TODO(C-10 collapse): hono/client collapses api.auth.me.$get to a non-callable
    // union; localized assertion until the typed-hono spike resolves it. Binding preserved.
    (api.auth.me.$get as unknown as (args?: unknown) => Promise<Response>)(),
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
    const submission = parseWithZod(fd, { schema: changePasswordSchema });
    if (submission.status !== "success") {
      return submission.reply();
    }
    const { currentPassword, newPassword } = submission.value;
    // confirmPassword is client-only validation; the server schema only accepts currentPassword + newPassword.

    // TODO(C-10 collapse): hono/client collapses api.auth["change-password"].$post body type;
    // localized assertion keeps the in-process binding. Binding preserved.
    const res = await (api.auth["change-password"].$post as unknown as (args: { json: { currentPassword: string; newPassword: string } }) => Promise<Response>)({
      json: { currentPassword, newPassword },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return submission.reply({
        formErrors: [(err as Record<string, string>)?.message || "Password change failed"],
      });
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
        const errBody = (await res.json().catch(() => null)) as
          | { error?: { message?: string; field?: string } }
          | null;
        return {
          intent,
          success: false,
          error: errBody?.error?.message ?? "Failed to save Turnstile key.",
          field: errBody?.error?.field ?? null,
        };
      }
    }
    return { intent, success: true, error: null, field: null };
  }

  if (intent === "export-data") {
    // TODO(C-10 collapse): hono/client collapses api.identity.account path;
    // localized assertion until the typed-hono spike resolves it. Binding preserved.
    const identityClient = api.identity as unknown as { account: { export: { $post: (args?: unknown) => Promise<Response> }; delete: { $post: (args: { json: { confirmEmail: string } }) => Promise<Response> } } };
    const res = await identityClient.account.export.$post();
    if (!res.ok) {
      return { success: false, error: "Data export failed. Please try again." };
    }
    return { success: true, error: null, message: "Data export complete. Your account data is available below." };
  }

  if (intent === "delete-account") {
    const submission = parseWithZod(fd, { schema: deleteAccountSchema });
    if (submission.status !== "success") {
      return submission.reply();
    }
    const confirmEmail = submission.value.confirmEmail.trim();
    const identityClient2 = api.identity as unknown as { account: { export: { $post: (args?: unknown) => Promise<Response> }; delete: { $post: (args: { json: { confirmEmail: string } }) => Promise<Response> } } };
    const res = await identityClient2.account.delete.$post({ json: { confirmEmail } });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = (err as { error?: { message?: string } })?.error?.message
        ?? (err as Record<string, string>)?.message
        ?? "Account deletion failed.";
      return submission.reply({ formErrors: [msg] });
    }
    return { success: true, error: null, message: "Account deleted." };
  }

  return { success: false, error: "Unknown action" };
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function SettingsSecurityPage() {
  const { user, secrets } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const [showPassword, setShowPassword] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const savingTurnstile =
    nav.state !== "idle" && nav.formData?.get("intent") === "save-turnstile";

  // Transient success flash — visible for 4s after a save round-trip.
  const [flashVisible, setFlashVisible] = useState(false);
  useEffect(() => {
    if (actionData && "success" in actionData && actionData.success) {
      setFlashVisible(true);
      const t = setTimeout(() => setFlashVisible(false), 4000);
      return () => clearTimeout(t);
    }
  }, [actionData]);

  // Map the server `field` error onto the matching SecretField (Turnstile).
  const turnstileFieldError = (name: string): string | undefined => {
    if (
      actionData &&
      "field" in actionData &&
      actionData.field === name &&
      "success" in actionData &&
      !actionData.success
    ) {
      return (actionData as { error?: string | null }).error ?? undefined;
    }
    return undefined;
  };

  // Conform owns the change-password form. Guard so non-Conform actionData
  // (save-turnstile / export-data) isn't fed into useForm.
  const pwResult = actionData && "status" in actionData && (actionData as { intent?: string }).intent !== "delete-account" ? actionData : undefined;
  const [pwForm, pwFields] = useForm({
    lastResult: pwResult,
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: changePasswordSchema });
    },
    shouldValidate: "onBlur",
    shouldRevalidate: "onInput",
  });

  // Conform for the delete-account form.
  const deleteResult =
    actionData && "status" in actionData && (actionData as { intent?: string }).intent === "delete-account"
      ? actionData
      : undefined;
  const [deleteForm, deleteFields] = useForm({
    lastResult: deleteResult,
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: deleteAccountSchema });
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
        <span className="text-ih-fg-1">Account & Security</span>
      </div>
      <h2 className="text-[19px] font-bold text-ih-fg-1">Account & Security</h2>
      <p className="text-[13px] text-ih-fg-3">Password, two-factor authentication, account data, and security settings.</p>

      {/* Flash */}
      {flashVisible && actionData && "success" in actionData && actionData.success && (
        <div className="px-4 py-2.5 rounded-md bg-ih-ok-bg border border-ih-ok-fg/20 text-[13px] text-ih-ok-fg font-medium">
          {(actionData as Record<string, unknown>).message as string || "Saved."}
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

      {/* Account info */}
      <section className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-4">
        <h3 className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">Account details</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-4 mb-1">Email</p>
            <p className="text-[13px] text-ih-fg-1 font-medium">{user.email || "Not set"}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-4 mb-1">Name</p>
            <p className="text-[13px] text-ih-fg-1 font-medium">{user.name || "Not set"}</p>
          </div>
        </div>
      </section>

      {/* Change password */}
      <section className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-5">
        <h3 className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">Change password</h3>
        <Form
          method="post"
          id={pwForm.id}
          onSubmit={pwForm.onSubmit}
          noValidate
          className="space-y-4 max-w-md"
        >
          <input type="hidden" name="intent" value="change-password" />
          <div className="space-y-2">
            <label htmlFor={pwFields.currentPassword.id} className="block text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">Current password</label>
            <input type={showPassword ? "text" : "password"} id={pwFields.currentPassword.id} name={pwFields.currentPassword.name} autoComplete="current-password"
              aria-invalid={pwFields.currentPassword.errors ? true : undefined}
              className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none text-[13px] text-ih-fg-1" />
            {pwFields.currentPassword.errors && (
              <p className="mt-1 text-xs text-ih-bad-fg">{pwFields.currentPassword.errors[0]}</p>
            )}
          </div>
          <div className="space-y-2">
            <label htmlFor={pwFields.newPassword.id} className="block text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">New password</label>
            <input type={showPassword ? "text" : "password"} id={pwFields.newPassword.id} name={pwFields.newPassword.name} autoComplete="new-password"
              aria-invalid={pwFields.newPassword.errors ? true : undefined}
              className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none text-[13px] text-ih-fg-1" />
            {pwFields.newPassword.errors && (
              <p className="mt-1 text-xs text-ih-bad-fg">{pwFields.newPassword.errors[0]}</p>
            )}
          </div>
          <div className="space-y-2">
            <label htmlFor={pwFields.confirmPassword.id} className="block text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">Confirm new password</label>
            <input type={showPassword ? "text" : "password"} id={pwFields.confirmPassword.id} name={pwFields.confirmPassword.name} autoComplete="new-password"
              aria-invalid={pwFields.confirmPassword.errors ? true : undefined}
              className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none text-[13px] text-ih-fg-1" />
            {pwFields.confirmPassword.errors && (
              <p className="mt-1 text-xs text-ih-bad-fg">{pwFields.confirmPassword.errors[0]}</p>
            )}
          </div>
          {pwForm.errors && (
            <div className="px-3 py-2 rounded-md bg-ih-bad-bg border border-ih-bad text-[13px] text-ih-bad-fg">
              {pwForm.errors[0]}
            </div>
          )}
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
                {user.totpEnabled ? "Enabled. Required at every log in." : "Not enabled."}
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
            error={turnstileFieldError("TURNSTILE_SECRET_KEY")}
            hint="Bot protection on booking and signup forms. Create at dash.cloudflare.com → Turnstile. Use test key 1x0000000000000000000000000000000AA for development"
          />
          <div className="flex justify-end pt-2 border-t border-ih-border">
            <button type="submit" disabled={savingTurnstile}
              className="h-9 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 active:scale-[.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed">
              {savingTurnstile ? "Saving…" : "Save"}
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
          <Form
            method="post"
            id={deleteForm.id}
            onSubmit={deleteForm.onSubmit}
            noValidate
            className="space-y-3 max-w-sm"
          >
            <input type="hidden" name="intent" value="delete-account" />
            <div className="space-y-2">
              <label htmlFor={deleteFields.confirmEmail.id} className="block text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">
                Retype your email to confirm
              </label>
              <input
                type="email"
                id={deleteFields.confirmEmail.id}
                name={deleteFields.confirmEmail.name}
                autoComplete="off"
                aria-invalid={deleteFields.confirmEmail.errors ? true : undefined}
                placeholder={user.email ?? "your@email.com"}
                className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-bad focus:shadow-ih-focus outline-none text-[13px] text-ih-fg-1"
              />
              {deleteFields.confirmEmail.errors && (
                <p className="mt-1 text-xs text-ih-bad-fg">{deleteFields.confirmEmail.errors[0]}</p>
              )}
            </div>
            {deleteForm.errors && (
              <div className="px-3 py-2 rounded-md bg-ih-bad-bg border border-ih-bad text-[13px] text-ih-bad-fg">
                {deleteForm.errors[0]}
              </div>
            )}
            <div className="flex gap-2">
              <button type="button" onClick={() => setShowDeleteConfirm(false)}
                className="h-9 px-3 rounded-md border border-ih-border text-[13px] font-medium text-ih-fg-2 hover:bg-ih-bg-muted transition-colors">
                Cancel
              </button>
              <button type="submit"
                className="h-9 px-4 rounded-md bg-ih-bad text-white font-bold text-[13px] hover:bg-ih-bad/85 active:scale-[.98] transition-all">
                Permanently delete
              </button>
            </div>
          </Form>
        )}
      </section>
    </div>
  );
}
