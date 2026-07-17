import { Form, useActionData, useLoaderData, useNavigation, redirect } from "react-router";
import { useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod/v4";
import type { Route } from "./+types/login";
import { getToken, createSessionWithToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { makeLoginSchema } from "~/lib/forms/auth.schema";
import { AuthShell } from "~/components/AuthShell";
import { safeReturnTo } from "../../server/lib/mcp/safe-return-to";
import { m } from "~/paraglide/messages";

export function meta() {
  return [{ title: m.auth_login_meta_title() }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  // B-26 — SaaS deploys have no local login: identities live on the portal
  // (POST /api/auth/login already answers 410 LOGIN_MOVED_TO_PORTAL there).
  // Bounce the PAGE too, so app.<domain>/login never renders a dead form.
  // Mirrors getDeploymentProfile(): saas mode + PORTAL_API_URL as the base.
  const env = (context as { cloudflare?: { env?: { APP_MODE?: string; PORTAL_API_URL?: string } } })
    ?.cloudflare?.env;
  if (env?.APP_MODE === "saas" && env.PORTAL_API_URL) {
    return redirect(`${env.PORTAL_API_URL.replace(/\/$/, "")}/login`);
  }

  // Preserve a post-login destination (e.g. the OAuth consent loader bounces
  // here with ?returnTo=<same-origin /oauth/authorize URL>). safeReturnTo gates
  // it to same-origin paths, so an attacker can't turn this into an open
  // redirect. Absent/invalid → /inspections (unchanged behavior).
  const returnTo = new URL(request.url).searchParams.get("returnTo");
  const token = await getToken(context, request);
  if (token) return redirect(safeReturnTo(returnTo, "/inspections"));
  return { returnTo };
}

export async function action({ request, context }: Route.ActionArgs) {
  const formData = await request.formData();
  // Same schema as the client (Conform onValidate) — defends the API and powers
  // the no-JS path (the native form POST lands here without client validation).
  const submission = parseWithZod(formData, { schema: makeLoginSchema() });
  if (submission.status !== "success") {
    return submission.reply();
  }
  const { email, password } = submission.value;

  try {
    const api = createApi(context);
    const res = await api.auth.login.$post(
      { json: { email, password } },
      { headers: { "x-token-relay": "1" } },
    );

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[login] API error:", res.status, res.statusText, text.slice(0, 500));
      let parsedErr: Record<string, unknown> = {};
      try { parsedErr = JSON.parse(text); } catch { /* response wasn't JSON — fall through to default error */ }
      const message =
        (parsedErr?.error as Record<string, string>)?.message ??
        m.auth_login_error_failed_with_status({ status: res.status });
      return submission.reply({ formErrors: [message] });
    }

    const body = (await res.json().catch(() => ({}))) as Record<string, Record<string, unknown>>;
    const jwt = body?.data?.token as string | undefined;

    if (jwt) {
      // Honor a same-origin returnTo carried by the form's hidden field (the
      // OAuth consent flow relies on this to resume after login).
      const returnTo = formData.get("returnTo");
      const dest = safeReturnTo(typeof returnTo === "string" ? returnTo : null, "/inspections");
      return createSessionWithToken(context, jwt, dest);
    }

    if (body?.data?.requires2fa) {
      return submission.reply({ formErrors: [m.auth_login_error_2fa_unsupported()] });
    }

    return submission.reply({ formErrors: [m.auth_login_error_no_token()] });
  } catch {
    return submission.reply({ formErrors: [m.auth_login_error_network()] });
  }
}

export default function LoginPage() {
  const lastResult = useActionData<typeof action>();
  const data = useLoaderData<typeof loader>();
  const returnTo = data && "returnTo" in data ? (data.returnTo ?? "") : "";
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  // Conform threads server validation back through `lastResult`, so field- and
  // form-level errors come from ONE place whether validated on the client
  // (onValidate) or the server (the action's parseWithZod) — no manual merging.
  const [form, fields] = useForm({
    lastResult,
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: makeLoginSchema() });
    },
    shouldValidate: "onBlur",
    shouldRevalidate: "onInput",
  });

  return (
    <AuthShell
      heading={m.auth_login_heading()}
      subtitle={m.auth_login_subtitle()}
    >
        <Form
          method="post"
          id={form.id}
          onSubmit={form.onSubmit}
          noValidate
          className="space-y-4"
        >
          {returnTo ? (
            <input type="hidden" name="returnTo" value={returnTo} />
          ) : null}
          <div>
            <label htmlFor={fields.email.id} className="block text-xs font-bold text-ih-fg-3 mb-1">
              {m.auth_login_email_label()}
            </label>
            <input
              id={fields.email.id}
              name={fields.email.name}
              type="email"
              autoFocus
              aria-invalid={fields.email.errors ? true : undefined}
              className="w-full px-3 py-2 rounded-lg border border-ih-border bg-ih-bg-card text-ih-fg-1 text-sm focus:shadow-ih-focus focus:border-ih-primary outline-none"
            />
            {/* Reserve the error slot's height so the onBlur validation message
                doesn't shift the "Forgot password?" link below it (which would
                let a click land above the moved link and miss). */}
            <p className="mt-1 min-h-4 text-xs text-ih-bad-fg" aria-live="polite">
              {fields.email.errors?.[0] ?? ""}
            </p>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor={fields.password.id} className="block text-xs font-bold text-ih-fg-3">
                {m.auth_login_password_label()}
              </label>
              <a href="/forgot-password" className="text-xs font-bold text-ih-primary hover:underline">
                {m.auth_login_forgot_link()}
              </a>
            </div>
            <input
              id={fields.password.id}
              name={fields.password.name}
              type="password"
              aria-invalid={fields.password.errors ? true : undefined}
              className="w-full px-3 py-2 rounded-lg border border-ih-border bg-ih-bg-card text-ih-fg-1 text-sm focus:shadow-ih-focus focus:border-ih-primary outline-none"
            />
            <p className="mt-1 min-h-4 text-xs text-ih-bad-fg" aria-live="polite">
              {fields.password.errors?.[0] ?? ""}
            </p>
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
            {isSubmitting ? m.auth_login_submit_pending() : m.auth_login_submit()}
          </button>
        </Form>
    </AuthShell>
  );
}
