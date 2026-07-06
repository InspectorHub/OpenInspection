import { Form, useActionData, useLoaderData, useNavigation, redirect } from "react-router";
import { useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod/v4";
import type { Route } from "./+types/join";
import { createApi } from "~/lib/api-client.server";
import { joinSchema, PASSWORD_HINT } from "~/lib/forms/auth.schema";
import { AuthShell } from "~/components/AuthShell";

export function meta() {
  return [{ title: "Accept Invite - OpenInspection" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || "";

  if (!token) {
    return { valid: false, error: "Missing invite token", invite: null, token: "" };
  }

  try {
    const api = createApi(context);
    const res = await api.auth["invite-info"].$get({ query: { token } });
    if (!res.ok) {
      return { valid: false, error: "Invalid or expired invite link", invite: null, token };
    }
    const body = await res.json();
    const d = ((body as Record<string, unknown>).data ?? {}) as Record<string, unknown>;
    return {
      valid: true,
      error: null,
      invite: (Object.keys(d).length > 0 ? d : null) as { email: string; workspaceName: string } | null,
      token,
    };
  } catch {
    return { valid: false, error: "Service unavailable", invite: null, token: "" };
  }
}

export async function action({ request, context }: Route.ActionArgs) {
  const formData = await request.formData();
  // Token rides along as a hidden field (sourced from the URL), NOT a schema
  // field — the schema only validates the user-typed name + password.
  const token = String(formData.get("token") || "");
  const submission = parseWithZod(formData, { schema: joinSchema });
  if (submission.status !== "success") {
    return submission.reply();
  }
  const { name, password } = submission.value;

  try {
    const api = createApi(context);
    const res = await api.auth.join.$post({
      json: { token, password, name },
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const message =
        (body as Record<string, Record<string, string>>)?.error?.message ??
        "Could not accept invite. The link may have expired.";
      return submission.reply({ formErrors: [message] });
    }

    const setCookieHeader = res.headers.get("set-cookie") || "";
    const tokenMatch = setCookieHeader.match(
      /(?:inspector_token|__Host-inspector_token)=([^;]+)/,
    );
    const jwt = tokenMatch?.[1];

    if (jwt) {
      const { createSessionWithToken: createSession } = await import(
        "~/lib/session.server"
      );
      return createSession(context, jwt, "/inspections");
    }

    return redirect("/login");
  } catch {
    return submission.reply({ formErrors: ["Network error — is the API server running?"] });
  }
}

export default function JoinPage() {
  const { valid, error: loaderError, invite, token } = useLoaderData<typeof loader>();
  const lastResult = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [form, fields] = useForm({
    lastResult,
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: joinSchema });
    },
    shouldValidate: "onBlur",
    shouldRevalidate: "onInput",
  });

  if (!valid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ih-bg-app">
        <div className="text-center p-8">
          <h1 className="text-2xl font-bold text-ih-fg-1 mb-2">
            Invalid Invite
          </h1>
          <p className="text-sm text-ih-fg-3">{loaderError}</p>
        </div>
      </div>
    );
  }

  return (
    <AuthShell
      heading={`Join ${invite?.workspaceName ?? "the team"}`}
      subtitle={`You have been invited${invite?.email ? ` as ${invite.email}` : ""}. Set your name and password to get started.`}
    >
        <Form method="post" id={form.id} onSubmit={form.onSubmit} noValidate className="space-y-4">
          <input type="hidden" name="token" value={token} />
          <div>
            <label htmlFor={fields.name.id} className="block text-xs font-bold text-ih-fg-3 mb-1">
              Full name
            </label>
            <input
              id={fields.name.id}
              name={fields.name.name}
              type="text"
              autoFocus
              aria-invalid={fields.name.errors ? true : undefined}
              className="w-full px-3 py-2 rounded-lg border border-ih-border bg-ih-bg-card text-ih-fg-1 text-sm focus:shadow-ih-focus focus:border-ih-primary outline-none"
            />
            {fields.name.errors && (
              <p className="mt-1 text-xs text-ih-bad-fg">{fields.name.errors[0]}</p>
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
              className="w-full px-3 py-2 rounded-lg border border-ih-border bg-ih-bg-card text-ih-fg-1 text-sm focus:shadow-ih-focus focus:border-ih-primary outline-none"
            />
            <p className="mt-1 text-xs text-ih-fg-3">{PASSWORD_HINT}</p>
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
            {isSubmitting ? "Accepting…" : "Accept Invite"}
          </button>
        </Form>
    </AuthShell>
  );
}
