import { Form, useActionData, useNavigation, redirect } from "react-router";
import type { Route } from "./+types/login";
import { getToken, createSessionWithToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";

export function meta() {
  return [{ title: "Sign In - OpenInspection" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await getToken(context, request);
  if (token) return redirect("/dashboard");
  return null;
}

export async function action({ request, context }: Route.ActionArgs) {
  const formData = await request.formData();
  const email = String(formData.get("email") || "");
  const password = String(formData.get("password") || "");

  try {
    const api = createApi(context);
    const res = await api.auth.login.$post({
      json: { email, password },
      header: { "x-token-relay": "1" },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[login] API error:", res.status, res.statusText, text.slice(0, 500));
      let parsed: Record<string, unknown> = {};
      try { parsed = JSON.parse(text); } catch { /* response wasn't JSON — fall through to default error */ }
      return {
        error:
          (parsed?.error as Record<string, string>)?.message ??
          `Login failed (${res.status})`,
      };
    }

    const body = (await res.json().catch(() => ({}))) as Record<string, Record<string, unknown>>;
    const jwt = body?.data?.token as string | undefined;

    if (jwt) {
      return createSessionWithToken(context, jwt, "/dashboard");
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
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

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
          Sign in to your workspace
        </h1>
        <p className="text-sm text-ih-fg-3 mb-6">
          Enter your credentials to access inspections, reports, and team tools.
        </p>

        <Form method="post" className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-ih-fg-3 mb-1">
              Email address
            </label>
            <input
              name="email"
              type="email"
              required
              autoFocus
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
              className="w-full px-3 py-2 rounded-lg border border-ih-border bg-ih-bg-card text-ih-fg-1 text-sm focus:shadow-ih-focus focus:border-indigo-500 outline-none"
            />
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
            {isSubmitting ? "Signing in…" : "Sign In"}
          </button>
        </Form>
      </div>
    </div>
  );
}
