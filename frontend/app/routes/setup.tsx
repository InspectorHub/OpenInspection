import { Form, useActionData, useNavigation, redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/setup";
import { getToken, createSessionWithToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";

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
  const workspaceName = String(formData.get("workspaceName") || "");
  const adminName = String(formData.get("adminName") || "");
  const email = String(formData.get("email") || "");
  const password = String(formData.get("password") || "");
  const setupCode = String(formData.get("setupCode") || "");

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
      return {
        error:
          (body as Record<string, Record<string, string>>)?.error?.message ??
          "Setup failed. Please check your inputs.",
      };
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

    return { error: "Setup succeeded but no session was created" };
  } catch {
    return { error: "Network error — is the API server running?" };
  }
}

export default function SetupPage() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  useLoaderData<typeof loader>();

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

        <Form method="post" className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-ih-fg-3 mb-1">
              Workspace name
            </label>
            <input
              name="workspaceName"
              type="text"
              required
              autoFocus
              placeholder="Acme Home Inspections"
              className="w-full px-3 py-2 rounded-lg border border-ih-border bg-ih-bg-card text-ih-fg-1 text-sm focus:shadow-ih-focus focus:border-indigo-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-ih-fg-3 mb-1">
              Your name
            </label>
            <input
              name="adminName"
              type="text"
              required
              autoComplete="name"
              placeholder="Mike Reynolds"
              className="w-full px-3 py-2 rounded-lg border border-ih-border bg-ih-bg-card text-ih-fg-1 text-sm focus:shadow-ih-focus focus:border-indigo-500 outline-none"
            />
            <p className="mt-1 text-[11px] text-ih-fg-3">
              Shown on your public booking link, signed agreements, and invoices.
            </p>
          </div>
          <div>
            <label className="block text-xs font-bold text-ih-fg-3 mb-1">
              Admin email
            </label>
            <input
              name="email"
              type="email"
              required
              className="w-full px-3 py-2 rounded-lg border border-ih-border bg-ih-bg-card text-ih-fg-1 text-sm focus:shadow-ih-focus focus:border-indigo-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-ih-fg-3 mb-1">
              Password
            </label>
            <input
              name="password"
              type="password"
              required
              minLength={8}
              className="w-full px-3 py-2 rounded-lg border border-ih-border bg-ih-bg-card text-ih-fg-1 text-sm focus:shadow-ih-focus focus:border-indigo-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-ih-fg-3 mb-1">
              Setup code
            </label>
            <input
              name="setupCode"
              type="text"
              required
              minLength={6}
              placeholder="Setup verification code"
              className="w-full px-3 py-2 rounded-lg border border-ih-border bg-ih-bg-card text-ih-fg-1 text-sm focus:shadow-ih-focus focus:border-indigo-500 outline-none font-mono"
            />
            <p className="mt-1 text-[11px] text-ih-fg-3">
              Value of the <code className="px-1 py-0.5 bg-ih-bg-muted rounded text-ih-fg-3 font-mono text-[10px]">SETUP_CODE</code> secret you provisioned on the API Worker (e.g. <code className="px-1 py-0.5 bg-ih-bg-muted rounded text-ih-fg-3 font-mono text-[10px]">wrangler secret put SETUP_CODE</code>). Falls back to KV key <code className="px-1 py-0.5 bg-ih-bg-muted rounded text-ih-fg-3 font-mono text-[10px]">setup_verification_code</code> when unset.
            </p>
          </div>

          {actionData?.error && (
            <div className="px-3 py-2 rounded-lg bg-ih-bad-bg border border-ih-bad text-sm text-ih-bad-fg">
              {actionData.error}
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
