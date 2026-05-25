import { Form, useActionData, useLoaderData, redirect } from "react-router";
import type { Route } from "./+types/guest-join";
import { apiFetch } from "~/lib/api.server";
import { createSessionWithToken } from "~/lib/session.server";

export function meta() {
  return [{ title: "Join as Guest - OpenInspection" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || "";

  if (!token) {
    return { valid: false, error: "Missing invite token", invite: null };
  }

  try {

    const res = await apiFetch(`/api/auth/guest/validate?token=${encodeURIComponent(token)}`);
    if (!res.ok) {
      return { valid: false, error: "Invalid or expired guest link", invite: null };
    }
    const body = (await res.json()) as Record<string, unknown>;
    return {
      valid: true,
      error: null,
      invite: (body.data as { inspectionAddress: string; inspectorName: string }) ?? null,
    };
  } catch {
    return { valid: false, error: "Service unavailable", invite: null };
  }
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const token = String(formData.get("token") || "");
  const name = String(formData.get("name") || "");

  try {

    const res = await apiFetch("/api/auth/guest/accept", {
      method: "POST",
      body: JSON.stringify({ token, name }),
      csrf: true,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return {
        error:
          (body as Record<string, Record<string, string>>)?.error?.message ??
          "Could not join. The link may have expired.",
      };
    }

    const setCookieHeader = res.headers.get("set-cookie") || "";
    const tokenMatch = setCookieHeader.match(
      /(?:inspector_token|__Host-inspector_token)=([^;]+)/,
    );
    const jwt = tokenMatch?.[1];

    if (jwt) {


      return createSessionWithToken(jwt, "/dashboard");
    }

    return redirect("/dashboard");
  } catch {
    return { error: "Network error — is the API server running?" };
  }
}

export default function GuestJoinPage() {
  const { valid, error: loaderError, invite } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  if (!valid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900">
        <div className="text-center p-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-2">
            Link Unavailable
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
          Join as a guest
        </h1>
        <p className="text-sm text-slate-500 mb-6">
          {invite
            ? `${invite.inspectorName} has invited you to collaborate on the inspection at ${invite.inspectionAddress}.`
            : "You have been invited to collaborate on an inspection."}
        </p>

        <Form method="post" className="space-y-4">
          <input type="hidden" name="token" value={new URL(typeof window !== "undefined" ? window.location.href : "http://localhost").searchParams.get("token") || ""} />
          <div>
            <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">
              Your name
            </label>
            <input
              name="name"
              type="text"
              required
              autoFocus
              placeholder="Jane Smith"
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
            Join Inspection
          </button>
        </Form>
      </div>
    </div>
  );
}
