import { useEffect } from "react";
import { Form, useActionData, useLoaderData, useNavigation, redirect } from "react-router";
import { useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod/v4";
import type { Route } from "./+types/reset-password";
import { createApi } from "~/lib/api-client.server";
import { makeResetPasswordSchema, makePasswordHint } from "~/lib/forms/auth.schema";
import { AuthShell } from "~/components/AuthShell";
import { m } from "~/paraglide/messages";

export function meta() {
  return [{ title: m.auth_reset_meta_title() }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  // SaaS deploys reset via the portal — start them over there. Mirrors login.tsx.
  const env = (context as { cloudflare?: { env?: { APP_MODE?: string; PORTAL_API_URL?: string } } })
    ?.cloudflare?.env;
  if (env?.APP_MODE === "saas" && env.PORTAL_API_URL) {
    return redirect(`${env.PORTAL_API_URL.replace(/\/$/, "")}/forgot-password`);
  }
  const token = new URL(request.url).searchParams.get("token") || "";
  return { token };
}

export async function action({ request, context }: Route.ActionArgs) {
  const formData = await request.formData();
  // Token rides as a hidden field (sourced from the loader), NOT a schema field.
  const token = String(formData.get("token") || "");
  const submission = parseWithZod(formData, { schema: makeResetPasswordSchema() });
  if (submission.status !== "success") {
    return submission.reply();
  }
  const { newPassword } = submission.value;

  try {
    const api = createApi(context);
    const res = await api.auth["reset-password"].$post({ json: { token, newPassword } });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const message =
        (body as Record<string, Record<string, string>>)?.error?.message ??
        m.auth_reset_error_invalid_link();
      return submission.reply({ formErrors: [message] });
    }
    return { done: true };
  } catch {
    return submission.reply({ formErrors: [m.auth_login_error_network()] });
  }
}

export default function ResetPasswordPage() {
  const { token } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const done = !!(actionData && "done" in actionData);
  const lastResult = actionData && "done" in actionData ? undefined : actionData;
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  useEffect(() => {
    // Scrub the token from the address bar so it isn't shoulder-surfed or
    // leaked via history/referrer. The hidden field still carries it to POST.
    if (token && typeof window !== "undefined") {
      window.history.replaceState({}, "", "/reset-password");
    }
  }, [token]);

  const [form, fields] = useForm({
    lastResult,
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: makeResetPasswordSchema() });
    },
    shouldValidate: "onBlur",
    shouldRevalidate: "onInput",
  });

  if (!token) {
    return (
      <AuthShell
        heading={m.auth_reset_invalid_heading()}
        subtitle={m.auth_reset_error_invalid_link()}
      >
        <a
          href="/forgot-password"
          className="inline-block text-sm font-bold text-ih-primary hover:underline"
        >
          {m.auth_reset_request_new_link()}
        </a>
      </AuthShell>
    );
  }

  if (done) {
    return (
      <AuthShell
        heading={m.auth_reset_done_heading()}
        subtitle={m.auth_reset_done_subtitle()}
      >
        <a
          href="/login"
          className="inline-block text-sm font-bold text-ih-primary hover:underline"
        >
          {m.auth_reset_go_to_login()}
        </a>
      </AuthShell>
    );
  }

  return (
    <AuthShell heading={m.auth_reset_heading()}>
      <Form method="post" id={form.id} onSubmit={form.onSubmit} noValidate className="space-y-4">
        <input type="hidden" name="token" value={token} />
        <div>
          <label htmlFor={fields.newPassword.id} className="block text-xs font-bold text-ih-fg-3 mb-1">
            {m.auth_reset_password_label()}
          </label>
          <input
            id={fields.newPassword.id}
            name={fields.newPassword.name}
            type="password"
            autoFocus
            aria-invalid={fields.newPassword.errors ? true : undefined}
            className="w-full px-3 py-2 rounded-lg border border-ih-border bg-ih-bg-card text-ih-fg-1 text-sm focus:shadow-ih-focus focus:border-ih-primary outline-none"
          />
          <p className="mt-1 text-xs text-ih-fg-3">{makePasswordHint()}</p>
          {fields.newPassword.errors && (
            <p className="mt-1 text-xs text-ih-bad-fg">{fields.newPassword.errors[0]}</p>
          )}
        </div>

        {form.errors && (
          <div className="px-3 py-2 rounded-lg bg-ih-bad-bg border border-ih-bad text-sm text-ih-bad-fg">
            {form.errors[0]}
          </div>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full py-2.5 rounded-lg bg-ih-primary text-white font-bold text-sm hover:bg-ih-primary-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isSubmitting ? m.auth_reset_submit_pending() : m.auth_reset_submit()}
        </button>
      </Form>
    </AuthShell>
  );
}
