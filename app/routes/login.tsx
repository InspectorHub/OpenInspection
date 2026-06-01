import { Form, useActionData, useNavigation, redirect } from "react-router";
import { useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod/v4";
import type { Route } from "./+types/login";
import { getToken, createSessionWithToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { loginSchema } from "~/lib/forms/auth.schema";

export function meta() {
  return [{ title: "Log In - OpenInspection" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await getToken(context, request);
  if (token) return redirect("/dashboard");
  return null;
}

export async function action({ request, context }: Route.ActionArgs) {
  const formData = await request.formData();
  // Same schema as the client (Conform onValidate) — defends the API and powers
  // the no-JS path (the native form POST lands here without client validation).
  const submission = parseWithZod(formData, { schema: loginSchema });
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
        (parsedErr?.error as Record<string, string>)?.message ?? `Login failed (${res.status})`;
      return submission.reply({ formErrors: [message] });
    }

    const body = (await res.json().catch(() => ({}))) as Record<string, Record<string, unknown>>;
    const jwt = body?.data?.token as string | undefined;

    if (jwt) {
      return createSessionWithToken(context, jwt, "/dashboard");
    }

    if (body?.data?.requires2fa) {
      return submission.reply({ formErrors: ["2FA is not yet supported in the new frontend."] });
    }

    return submission.reply({ formErrors: ["Authentication succeeded but no token received"] });
  } catch {
    return submission.reply({ formErrors: ["Network error — is the API server running?"] });
  }
}

export default function LoginPage() {
  const lastResult = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  // Conform threads server validation back through `lastResult`, so field- and
  // form-level errors come from ONE place whether validated on the client
  // (onValidate) or the server (the action's parseWithZod) — no manual merging.
  const [form, fields] = useForm({
    lastResult,
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: loginSchema });
    },
    shouldValidate: "onBlur",
    shouldRevalidate: "onInput",
  });

  return (
    <div className="min-h-screen flex items-center justify-center bg-ih-bg-app">
      <div className="w-full max-w-md p-8">
        <div className="flex items-center gap-3 mb-8">
          <img src="/logo.svg" alt="" className="w-8 h-8" width={32} height={32} />
          <span className="text-lg font-bold text-ih-fg-1">
            OpenInspection
          </span>
        </div>

        <h1 className="text-2xl font-bold text-ih-fg-1 mb-2">
          Log in to your workspace
        </h1>
        <p className="text-sm text-ih-fg-3 mb-6">
          Enter your credentials to access inspections, reports, and team tools.
        </p>

        <Form
          method="post"
          id={form.id}
          onSubmit={form.onSubmit}
          noValidate
          className="space-y-4"
        >
          <div>
            <label htmlFor={fields.email.id} className="block text-xs font-bold text-ih-fg-3 mb-1">
              Email address
            </label>
            <input
              id={fields.email.id}
              name={fields.email.name}
              type="email"
              autoFocus
              aria-invalid={fields.email.errors ? true : undefined}
              className="w-full px-3 py-2 rounded-lg border border-ih-border bg-ih-bg-card text-ih-fg-1 text-sm focus:shadow-ih-focus focus:border-indigo-500 outline-none"
            />
            {fields.email.errors && (
              <p className="mt-1 text-xs text-ih-bad-fg">{fields.email.errors[0]}</p>
            )}
          </div>
          <div>
            <label htmlFor={fields.password.id} className="block text-xs font-bold text-ih-fg-3 mb-1">
              Password
            </label>
            <input
              id={fields.password.id}
              name={fields.password.name}
              type="password"
              aria-invalid={fields.password.errors ? true : undefined}
              className="w-full px-3 py-2 rounded-lg border border-ih-border bg-ih-bg-card text-ih-fg-1 text-sm focus:shadow-ih-focus focus:border-indigo-500 outline-none"
            />
            {fields.password.errors && (
              <p className="mt-1 text-xs text-ih-bad-fg">{fields.password.errors[0]}</p>
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
            {isSubmitting ? "Logging in…" : "Log In"}
          </button>
        </Form>
      </div>
    </div>
  );
}
