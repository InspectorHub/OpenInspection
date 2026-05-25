import { Form, useActionData, redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/setup";
import { getToken, createSessionWithToken } from "~/lib/session.server";
import { apiFetch } from "~/lib/api.server";

export function meta() {
  return [{ title: "Setup - OpenInspection" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  // If already authenticated, skip setup
  const token = await getToken(request);
  if (token) return redirect("/dashboard");

  // Check if workspace is already set up
  try {
    const res = await apiFetch("/api/auth/setup-status");
    const body = res.ok ? ((await res.json()) as Record<string, unknown>) : {};
    if ((body.data as Record<string, unknown>)?.isSetUp) {
      return redirect("/login");
    }
  } catch {
    // API unreachable — show setup form anyway
  }
  return { ready: true };
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const workspaceName = String(formData.get("workspaceName") || "");
  const adminName = String(formData.get("adminName") || "");
  const email = String(formData.get("email") || "");
  const password = String(formData.get("password") || "");
  const setupCode = String(formData.get("setupCode") || "");

  try {
    const res = await apiFetch("/api/auth/setup", {
      method: "POST",
      body: JSON.stringify({ workspaceName, adminName, email, password, setupCode }),
      csrf: true,
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
      return createSessionWithToken(jwt, "/dashboard");
    }

    return { error: "Setup succeeded but no session was created" };
  } catch {
    return { error: "Network error — is the API server running?" };
  }
}

export default function SetupPage() {
  const actionData = useActionData<typeof action>();
  useLoaderData<typeof loader>();

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900">
      <div className="w-full max-w-md p-8">
        <div className="flex items-center gap-3 mb-8">
          <img src="/logo.svg" alt="" className="w-8 h-8" />
          <span className="text-lg font-bold text-slate-900 dark:text-slate-100">
            OpenInspection
          </span>
        </div>

        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-2">
          Set up your workspace
        </h1>
        <p className="text-sm text-slate-500 mb-6">
          Create the first admin account and configure your inspection workspace.
        </p>

        <Form method="post" className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
              Workspace name
            </label>
            <input
              name="workspaceName"
              type="text"
              required
              autoFocus
              placeholder="Acme Home Inspections"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
              Your name
            </label>
            <input
              name="adminName"
              type="text"
              required
              autoComplete="name"
              placeholder="Mike Reynolds"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 outline-none"
            />
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              Shown on your public booking link, signed agreements, and invoices.
            </p>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
              Admin email
            </label>
            <input
              name="email"
              type="email"
              required
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
              Password
            </label>
            <input
              name="password"
              type="password"
              required
              minLength={8}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
              Setup code
            </label>
            <input
              name="setupCode"
              type="text"
              required
              placeholder="000000"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 outline-none"
            />
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              Find the 6-digit code in your Cloudflare deployment logs, or check the <code className="px-1 py-0.5 bg-slate-100 dark:bg-slate-700 rounded text-slate-700 dark:text-slate-300 font-mono text-[10px]">setup_verification_code</code> key in KV namespace.
            </p>
          </div>

          {actionData?.error && (
            <div className="px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
              {actionData.error}
            </div>
          )}

          <button
            type="submit"
            className="w-full py-2.5 rounded-lg bg-indigo-600 text-white font-bold text-sm hover:bg-indigo-700 transition-colors"
          >
            Create Workspace
          </button>
        </Form>
      </div>
    </div>
  );
}
