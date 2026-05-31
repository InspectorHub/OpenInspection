import { Form, useActionData, useNavigation, redirect, useLoaderData } from "react-router";
import { useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod/v4";
import type { Route } from "./+types/setup";
import { getToken, createSessionWithToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { setupSchema } from "~/lib/forms/auth.schema";

export function meta() {
  return [{ title: "Setup - OpenInspection" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  // If already authenticated, skip setup
  const token = await getToken(context, request);
  if (token) return redirect("/dashboard");

  // Check if workspace is already set up
  try {
    const api = createApi(context);
    const res = await api.auth["setup-status"].$get();
    const body = res.ok ? await res.json() : {};
    const d = ((body as Record<string, unknown>).data ?? {}) as Record<string, unknown>;
    if (d?.isSetUp) {
      return redirect("/login");
    }
  } catch {
    // API unreachable — show setup form anyway
  }
  return { ready: true };
}

export async function action({ request, context }: Route.ActionArgs) {
  const formData = await request.formData();
  const submission = parseWithZod(formData, { schema: setupSchema });
  if (submission.status !== "success") {
    return submission.reply();
  }
  const { workspaceName, adminName, email, password, setupCode } = submission.value;

  try {
    const api = createApi(context);
    const res = await api.auth.setup.$post({
      json: {
        companyName: workspaceName,
        adminName,
        email,
        password,
        verificationCode: setupCode,
      },
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const message =
        (body as Record<string, Record<string, string>>)?.error?.message ??
        "Setup failed. Please check your inputs.";
      return submission.reply({ formErrors: [message] });
    }

    // Extract JWT from Set-Cookie header
    const setCookieHeader = res.headers.get("set-cookie") || "";
    const tokenMatch = setCookieHeader.match(
      /(?:inspector_token|__Host-inspector_token)=([^;]+)/,
    );
    const jwt = tokenMatch?.[1];

    if (jwt) {
      return createSessionWithToken(context, jwt, "/dashboard");
    }

    return submission.reply({ formErrors: ["Setup succeeded but no session was created"] });
  } catch {
    return submission.reply({ formErrors: ["Network error — is the API server running?"] });
  }
}

export default function SetupPage() {
  const lastResult = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  useLoaderData<typeof loader>();

  const [form, fields] = useForm({
    lastResult,
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: setupSchema });
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
          Set up your workspace
        </h1>
        <p className="text-sm text-ih-fg-3 mb-6">
          Create the first admin account and configure your inspection workspace.
        </p>

        <Form
          method="post"
          id={form.id}
          onSubmit={form.onSubmit}
          noValidate
          className="space-y-4"
        >
          <div>
            <label htmlFor={fields.workspaceName.id} className="block text-xs font-bold text-ih-fg-3 mb-1">
              Workspace name
            </label>
            <input
              id={fields.workspaceName.id}
              name={fields.workspaceName.name}
              type="text"
              autoFocus
              placeholder="Acme Home Inspections"
              aria-invalid={fields.workspaceName.errors ? true : undefined}
              className="w-full px-3 py-2 rounded-lg border border-ih-border bg-ih-bg-card text-ih-fg-1 text-sm focus:shadow-ih-focus focus:border-indigo-500 outline-none"
            />
            {fields.workspaceName.errors && (
              <p className="mt-1 text-xs text-ih-bad-fg">{fields.workspaceName.errors[0]}</p>
            )}
          </div>
          <div>
            <label htmlFor={fields.adminName.id} className="block text-xs font-bold text-ih-fg-3 mb-1">
              Your name
            </label>
            <input
              id={fields.adminName.id}
              name={fields.adminName.name}
              type="text"
              autoComplete="name"
              placeholder="Mike Reynolds"
              aria-invalid={fields.adminName.errors ? true : undefined}
              className="w-full px-3 py-2 rounded-lg border border-ih-border bg-ih-bg-card text-ih-fg-1 text-sm focus:shadow-ih-focus focus:border-indigo-500 outline-none"
            />
            {fields.adminName.errors ? (
              <p className="mt-1 text-xs text-ih-bad-fg">{fields.adminName.errors[0]}</p>
            ) : (
              <p className="mt-1 text-[11px] text-ih-fg-3">
                Shown on your public booking link, signed agreements, and invoices.
              </p>
            )}
          </div>
          <div>
            <label htmlFor={fields.email.id} className="block text-xs font-bold text-ih-fg-3 mb-1">
              Admin email
            </label>
            <input
              id={fields.email.id}
              name={fields.email.name}
              type="email"
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
          <div>
            <label htmlFor={fields.setupCode.id} className="block text-xs font-bold text-ih-fg-3 mb-1">
              Setup code
            </label>
            <input
              id={fields.setupCode.id}
              name={fields.setupCode.name}
              type="text"
              placeholder="Setup verification code"
              aria-invalid={fields.setupCode.errors ? true : undefined}
              className="w-full px-3 py-2 rounded-lg border border-ih-border bg-ih-bg-card text-ih-fg-1 text-sm focus:shadow-ih-focus focus:border-indigo-500 outline-none font-mono"
            />
            {fields.setupCode.errors ? (
              <p className="mt-1 text-xs text-ih-bad-fg">{fields.setupCode.errors[0]}</p>
            ) : (
              <p className="mt-1 text-[11px] text-ih-fg-3">
                <span className="font-medium text-ih-fg-2">Required (at least 6 characters).</span> Enter the value of the <code className="px-1 py-0.5 bg-ih-bg-muted rounded text-ih-fg-3 font-mono text-[10px]">SETUP_CODE</code> secret. Don&apos;t have one yet? Add it to this Worker in the Cloudflare dashboard under <span className="font-medium text-ih-fg-2">Settings → Variables and Secrets</span> (type Secret), then refresh this page.{" "}
                <a
                  href="https://developers.cloudflare.com/workers/configuration/environment-variables/#add-environment-variables-via-the-dashboard"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-indigo-500 hover:text-indigo-600 underline underline-offset-2"
                >
                  How to add a secret →
                </a>
              </p>
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
            {isSubmitting ? "Creating workspace…" : "Create Workspace"}
          </button>
        </Form>
      </div>
    </div>
  );
}
