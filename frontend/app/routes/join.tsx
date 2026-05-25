import { Form, useActionData, useLoaderData, redirect } from "react-router";
import type { Route } from "./+types/join";
import { apiFetch, createSessionWithToken } from "~/lib/session.server";

export function meta() {
  return [{ title: "Accept Invite - OpenInspection" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || "";

  if (!token) {
    return { valid: false, error: "Missing invite token", invite: null };
  }

  try {
    const { apiFetch: apiFetchFn } = await import("~/lib/api.server");
    const res = await apiFetchFn(`/api/auth/invite/validate?token=${encodeURIComponent(token)}`);
    if (!res.ok) {
      return { valid: false, error: "Invalid or expired invite link", invite: null };
    }
    const body = (await res.json()) as Record<string, unknown>;
    return {
      valid: true,
      error: null,
      invite: (body.data as { email: string; workspaceName: string }) ?? null,
    };
  } catch {
    return { valid: false, error: "Service unavailable", invite: null };
  }
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const token = String(formData.get("token") || "");
  const password = String(formData.get("password") || "");
  const name = String(formData.get("name") || "");

  try {
    const { apiFetch: apiFetchFn } = await import("~/lib/api.server");
    const res = await apiFetchFn("/api/auth/invite/accept", {
      method: "POST",
      body: JSON.stringify({ token, password, name }),
      csrf: true,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return {
        error:
          (body as Record<string, Record<string, string>>)?.error?.message ??
          "Could not accept invite. The link may have expired.",
      };
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
      return createSession(jwt, "/dashboard");
    }

    return redirect("/login");
  } catch {
    return { error: "Network error — is the API server running?" };
  }
}

export default function JoinPage() {
  const { valid, error: loaderError, invite } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  if (!valid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900">
        <div className="text-center p-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-2">
            Invalid Invite
          </h1>
          <p className="text-sm text-slate-500">{loaderError}</p>
        </div>
      </div>
    );
  }

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
          Join {invite?.workspaceName ?? "the team"}
        </h1>
        <p className="text-sm text-slate-500 mb-6">
          You have been invited{invite?.email ? ` as ${invite.email}` : ""}. Set
          your name and password to get started.
        </p>

        <Form method="post" className="space-y-4">
          <input type="hidden" name="token" value={new URL(typeof window !== "undefined" ? window.location.href : "http://localhost").searchParams.get("token") || ""} />
          <div>
            <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
              Full name
            </label>
            <input
              name="name"
              type="text"
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
              minLength={8}
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
            Accept Invite
          </button>
        </Form>
      </div>
    </div>
  );
}
