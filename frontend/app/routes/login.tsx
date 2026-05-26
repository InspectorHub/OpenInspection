import { Form, useActionData, redirect } from "react-router";
import type { Route } from "./+types/login";
import { getToken, createSessionWithToken } from "~/lib/session.server";
import { apiFetch } from "~/lib/api.server";

export function meta() {
  return [{ title: "Sign In - OpenInspection" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const token = await getToken(request);
  if (token) return redirect("/dashboard");
  return null;
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const email = String(formData.get("email") || "");
  const password = String(formData.get("password") || "");

  try {
    const res = await apiFetch("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
      csrf: true,
      headers: { "x-token-relay": "1" },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[login] API error:", res.status, res.statusText, text.slice(0, 500));
      let parsed: Record<string, unknown> = {};
      try { parsed = JSON.parse(text); } catch {}
      return {
        error:
          (parsed?.error as Record<string, string>)?.message ??
          `Login failed (${res.status})`,
      };
    }

    const body = (await res.json().catch(() => ({}))) as Record<string, Record<string, unknown>>;
    const jwt = body?.data?.token as string | undefined;

    if (jwt) {
      return createSessionWithToken(jwt, "/dashboard");
    }

    if (body?.data?.requires2fa) {
      return { error: "2FA is not yet supported in the new frontend." };
    }

    return { error: "Authentication succeeded but no token received" };
  } catch {
    return { error: "Network error — is the API server running?" };
  }
}

export default function LoginPage() {
  const actionData = useActionData<typeof action>();

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
          Sign in to your workspace
        </h1>
        <p className="text-sm text-slate-500 mb-6">
          Enter your credentials to access inspections, reports, and team tools.
        </p>

        <Form method="post" className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
              Email address
            </label>
            <input
              name="email"
              type="email"
              required
              autoFocus
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
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 outline-none"
            />
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
            Sign In
          </button>
        </Form>
      </div>
    </div>
  );
}
