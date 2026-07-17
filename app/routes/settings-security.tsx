import { useState } from "react";
import { Form, useLoaderData, useActionData, useNavigation } from "react-router";
import { SettingsCrumb } from "~/components/SettingsCrumb";
import { useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod/v4";
import type { Route } from "./+types/settings-security";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { useFlash } from "~/hooks/useFlash";
import { makeChangePasswordSchema, makeDeleteAccountSchema } from "~/lib/forms/settings.schema";
import { ChangePasswordPanel } from "~/components/settings/security/ChangePasswordPanel";
import { TwoFactorPanel } from "~/components/settings/security/TwoFactorPanel";
import { TurnstilePanel } from "~/components/settings/security/TurnstilePanel";
import { DataExportPanel } from "~/components/settings/security/DataExportPanel";
import { m } from "~/paraglide/messages";

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
    const submission = parseWithZod(fd, { schema: makeChangePasswordSchema() });
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
        formErrors: [(err as Record<string, string>)?.message || m.settings_security_error_password_change_failed()],
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
          error: errBody?.error?.message ?? m.settings_security_error_turnstile_save_failed(),
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
      return { success: false, error: m.settings_security_error_export_failed() };
    }
    return { success: true, error: null, message: m.settings_security_export_success_message() };
  }

  if (intent === "delete-account") {
    const submission = parseWithZod(fd, { schema: makeDeleteAccountSchema() });
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
        ?? m.settings_security_error_delete_failed();
      return submission.reply({ formErrors: [msg] });
    }
    return { success: true, error: null, message: m.settings_security_delete_success_message() };
  }

  return { success: false, error: m.settings_security_error_unknown_action() };
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
  const { flashVisible } = useFlash(
    !!actionData && "success" in actionData && !!actionData.success,
    actionData,
  );

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
      return parseWithZod(formData, { schema: makeChangePasswordSchema() });
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
      return parseWithZod(formData, { schema: makeDeleteAccountSchema() });
    },
    shouldValidate: "onBlur",
    shouldRevalidate: "onInput",
  });

  return (
    <div className="space-y-ih-list max-w-3xl">
      <SettingsCrumb items={[{ label: m.settings_crumb_settings(), href: "/settings" }, { label: m.settings_security_crumb() }]} />
      <p className="text-[13px] text-ih-fg-3">{m.settings_security_subtitle()}</p>

      {/* Flash */}
      {flashVisible && actionData && "success" in actionData && actionData.success && (
        <div className="px-4 py-2.5 rounded-md bg-ih-ok-bg border border-ih-ok-fg/20 text-[13px] text-ih-ok-fg font-medium">
          {(actionData as Record<string, unknown>).message as string || m.settings_security_flash_saved()}
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
        <h3 className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">{m.settings_security_account_details_heading()}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-4 mb-1">{m.settings_security_email_label()}</p>
            <p className="text-[13px] text-ih-fg-1 font-medium">{user.email || m.settings_security_not_set()}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-4 mb-1">{m.settings_security_name_label()}</p>
            <p className="text-[13px] text-ih-fg-1 font-medium">{user.name || m.settings_security_not_set()}</p>
          </div>
        </div>
      </section>

      {/* Change password */}
      <ChangePasswordPanel
        pwForm={pwForm}
        pwFields={pwFields}
        showPassword={showPassword}
        setShowPassword={setShowPassword}
      />

      {/* 2FA status */}
      <TwoFactorPanel
        totpEnabled={user.totpEnabled}
        recoveryCodesRemaining={user.recoveryCodesRemaining}
      />

      {/* Turnstile bot protection */}
      <TurnstilePanel
        value={secrets.TURNSTILE_SECRET_KEY}
        fieldError={turnstileFieldError}
        saving={savingTurnstile}
      />

      {/* Active sessions placeholder */}
      <section className="bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-4">
        <h3 className="text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]">{m.settings_security_sessions_heading()}</h3>
        <div className="flex items-center gap-3 p-3 rounded-md bg-ih-bg-muted border border-ih-border">
          <div className="w-8 h-8 rounded-full bg-ih-primary-tint text-ih-primary flex items-center justify-center">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <p className="text-[13px] font-medium text-ih-fg-1">{m.settings_security_sessions_current()}</p>
            <p className="text-[11px] text-ih-fg-3">{m.settings_security_sessions_active_now()}</p>
          </div>
        </div>
        <p className="text-[11px] text-ih-fg-3">{m.settings_security_sessions_coming_soon()}</p>
      </section>

      {/* Data export */}
      <DataExportPanel />

      {/* Danger zone */}
      <section className="bg-ih-bg-card rounded-lg border border-ih-bad p-6 space-y-4">
        <h3 className="text-[11px] font-bold text-ih-bad-fg uppercase tracking-[0.2em]">{m.settings_security_danger_heading()}</h3>
        <div className="p-4 rounded-md bg-ih-bad-bg border border-ih-bad">
          <p className="text-[13px] font-bold text-ih-bad-fg mb-1">{m.settings_security_delete_title()}</p>
          <p className="text-[12px] text-ih-bad-fg leading-relaxed">
            {m.settings_security_delete_description()}
          </p>
        </div>

        {!showDeleteConfirm ? (
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            className="h-9 px-4 rounded-md border border-ih-bad text-ih-bad-fg text-[13px] font-bold hover:bg-ih-bad-bg transition-colors"
          >
            {m.settings_security_delete_button()}
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
                {m.settings_security_delete_confirm_label()}
              </label>
              <input
                type="email"
                id={deleteFields.confirmEmail.id}
                name={deleteFields.confirmEmail.name}
                autoComplete="off"
                aria-invalid={deleteFields.confirmEmail.errors ? true : undefined}
                placeholder={user.email ?? m.settings_security_delete_confirm_placeholder()}
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
                {m.common_cancel()}
              </button>
              <button type="submit"
                className="h-9 px-4 rounded-md bg-ih-bad text-white font-bold text-[13px] hover:bg-ih-bad/85 active:scale-[.98] transition-all">
                {m.settings_security_delete_confirm_button()}
              </button>
            </div>
          </Form>
        )}
      </section>
    </div>
  );
}
