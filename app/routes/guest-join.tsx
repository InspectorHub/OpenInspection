import { Form, useActionData, useLoaderData, useNavigation, redirect } from "react-router";
import { useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod/v4";
import type { Route } from "./+types/guest-join";
import { createApi } from "~/lib/api-client.server";
import { createSessionWithToken } from "~/lib/session.server";
import { guestJoinSchema } from "~/lib/forms/auth.schema";

export function meta() {
  return [{ title: "Join as Guest - OpenInspection" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || "";

  if (!token) {
    return { valid: false, error: "Missing invite token", invite: null };
  }

  try {

    const api = createApi(context);
    const res = await api.guest["invite-info"].$get({ query: { token } });
    if (!res.ok) {
      return { valid: false, error: "Invalid or expired guest link", invite: null };
    }
    const body = await res.json();
    const d = ((body as Record<string, unknown>).data ?? {}) as Record<string, unknown>;
    return {
      valid: true,
      error: null,
      invite: (Object.keys(d).length > 0 ? d : null) as { workspaceName: string; role: string; expiresAt: number } | null,
    };
  } catch {
    return { valid: false, error: "Service unavailable", invite: null };
  }
}

export async function action({ request, context }: Route.ActionArgs) {
  const formData = await request.formData();
  // Token rides along as a hidden field (sourced from the URL), NOT a schema
  // field — guests only set a display name (passwordless).
  const token = String(formData.get("token") || "");
  const submission = parseWithZod(formData, { schema: guestJoinSchema });
  if (submission.status !== "success") {
    return submission.reply();
  }
  const { name, email, password } = submission.value;

  try {

    const api = createApi(context);
    const res = await api.guest.claim.$post({
      json: { token, name, email, password },
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const message =
        (body as Record<string, Record<string, string>>)?.error?.message ??
        "Could not join. The link may have expired.";
      return submission.reply({ formErrors: [message] });
    }

    const setCookieHeader = res.headers.get("set-cookie") || "";
    const tokenMatch = setCookieHeader.match(
      /(?:inspector_token|__Host-inspector_token)=([^;]+)/,
    );
    const jwt = tokenMatch?.[1];

    if (jwt) {


      return createSessionWithToken(context, jwt, "/dashboard");
    }

    return redirect("/dashboard");
  } catch {
    return submission.reply({ formErrors: ["Network error — is the API server running?"] });
  }
}

export default function GuestJoinPage() {
  const { valid, error: loaderError, invite } = useLoaderData<typeof loader>();
  const lastResult = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [form, fields] = useForm({
    lastResult,
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: guestJoinSchema });
    },
    shouldValidate: "onBlur",
    shouldRevalidate: "onInput",
  });

  if (!valid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ih-bg-app">
        <div className="text-center p-8">
          <h1 className="text-2xl font-bold text-ih-fg-1 mb-2">
            Link Unavailable
          </h1>
          <p className="text-sm text-ih-fg-3">{loaderError}</p>
        </div>
      </div>
    );
  }

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
          Join as a guest
        </h1>
        <p className="text-sm text-ih-fg-3 mb-6">
          {invite
            ? `You've been invited to join ${invite.workspaceName} as a ${invite.role}. Create your account below.`
            : "You have been invited to collaborate. Create your account below."}
        </p>

        <Form method="post" id={form.id} onSubmit={form.onSubmit} noValidate className="space-y-4">
          <input type="hidden" name="token" value={new URL(typeof window !== "undefined" ? window.location.href : "http://localhost").searchParams.get("token") || ""} />
          <div>
            <label htmlFor={fields.name.id} className="block text-xs font-bold text-ih-fg-3 mb-1">
              Your name
            </label>
            <input
              id={fields.name.id}
              name={fields.name.name}
              type="text"
              autoFocus
              placeholder="Jane Smith"
              aria-invalid={fields.name.errors ? true : undefined}
              className="w-full px-3 py-2 rounded-lg border border-ih-border bg-ih-bg-card text-ih-fg-1 text-sm focus:shadow-ih-focus focus:border-indigo-500 outline-none"
            />
            {fields.name.errors && (
              <p className="mt-1 text-xs text-ih-bad-fg">{fields.name.errors[0]}</p>
            )}
          </div>

          <div>
            <label htmlFor={fields.email.id} className="block text-xs font-bold text-ih-fg-3 mb-1">
              Email
            </label>
            <input
              id={fields.email.id}
              name={fields.email.name}
              type="email"
              autoComplete="email"
              placeholder="jane@example.com"
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
              autoComplete="new-password"
              placeholder="At least 8 characters"
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
            {isSubmitting ? "Joining…" : "Join Inspection"}
          </button>
        </Form>
      </div>
    </div>
  );
}
