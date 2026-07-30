import { Form, useActionData, useLoaderData, useNavigation, redirect } from "react-router";
import { useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod/v4";
import type { Route } from "./+types/join";
import { createApi } from "~/lib/api-client.server";
import { makeJoinSchema, makePasswordHint } from "~/lib/forms/auth.schema";
import { AuthShell } from "~/components/AuthShell";
import { Input, Button } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

export function meta() {
  return [{ title: m.auth_join_meta_title() }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || "";

  if (!token) {
    return { valid: false, error: m.auth_join_error_missing_token(), invite: null, token: "" };
  }

  try {
    const api = createApi(context);
    const res = await api.auth["invite-info"].$get({ query: { token } });
    if (!res.ok) {
      return { valid: false, error: m.auth_join_error_invalid(), invite: null, token };
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
    return { valid: false, error: m.auth_join_error_unavailable(), invite: null, token: "" };
  }
}

export async function action({ request, context }: Route.ActionArgs) {
  const formData = await request.formData();
  // Token rides along as a hidden field (sourced from the URL), NOT a schema
  // field — the schema only validates the user-typed name + password.
  const token = String(formData.get("token") || "");
  const submission = parseWithZod(formData, { schema: makeJoinSchema() });
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
        m.auth_join_error_accept_failed();
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
    return submission.reply({ formErrors: [m.auth_login_error_network()] });
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
      return parseWithZod(formData, { schema: makeJoinSchema() });
    },
    shouldValidate: "onBlur",
    shouldRevalidate: "onInput",
  });

  if (!valid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ih-bg-app">
        <div className="text-center p-8">
          <h1 className="text-2xl font-bold text-ih-fg-1 mb-2">
            {m.auth_join_invalid_heading()}
          </h1>
          <p className="text-sm text-ih-fg-3">{loaderError}</p>
        </div>
      </div>
    );
  }

  return (
    <AuthShell
      heading={m.auth_join_heading({ name: invite?.workspaceName ?? m.auth_join_heading_fallback_name() })}
      subtitle={invite?.email
        ? m.auth_join_subtitle_invited_as({ email: invite.email })
        : m.auth_join_subtitle_invited()}
    >
        <Form method="post" id={form.id} onSubmit={form.onSubmit} noValidate className="space-y-4">
          <input type="hidden" name="token" value={token} />
          <Input
            id={fields.name.id}
            name={fields.name.name}
            type="text"
            autoFocus
            label={m.auth_join_name_label()}
            aria-invalid={fields.name.errors ? true : undefined}
            error={fields.name.errors?.[0]}
          />
          <Input
            id={fields.password.id}
            name={fields.password.name}
            type="password"
            label={m.auth_login_password_label()}
            aria-invalid={fields.password.errors ? true : undefined}
            hint={makePasswordHint()}
            error={fields.password.errors?.[0]}
          />

          {form.errors && (
            <div className="px-3 py-2 rounded-lg bg-ih-bad-bg border border-ih-bad text-sm text-ih-bad-fg">
              {form.errors[0]}
            </div>
          )}

          <Button type="submit" variant="primary" size="lg" disabled={isSubmitting} className="w-full">
            {isSubmitting ? m.auth_join_submit_pending() : m.auth_join_submit()}
          </Button>
        </Form>
    </AuthShell>
  );
}
