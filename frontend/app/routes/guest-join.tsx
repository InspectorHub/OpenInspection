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
    const body = await res.json();
    const d = ((body as Record<string, unknown>).data ?? {}) as Record<string, unknown>;
    return {
      valid: true,
      error: null,
      invite: (Object.keys(d).length > 0 ? d : null) as { inspectionAddress: string; inspectorName: string } | null,
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
          <img src="/logo.svg" alt="" className="w-8 h-8" />
          <span className="text-lg font-bold text-ih-fg-1">
            OpenInspection
          </span>
        </div>

        <h1 className="text-2xl font-bold text-ih-fg-1 mb-2">
          Join as a guest
        </h1>
        <p className="text-sm text-ih-fg-3 mb-6">
          {invite
            ? `${invite.inspectorName} has invited you to collaborate on the inspection at ${invite.inspectionAddress}.`
            : "You have been invited to collaborate on an inspection."}
        </p>

        <Form method="post" className="space-y-4">
          <input type="hidden" name="token" value={new URL(typeof window !== "undefined" ? window.location.href : "http://localhost").searchParams.get("token") || ""} />
          <div>
            <label className="block text-xs font-bold text-ih-fg-3 mb-1">
              Your name
            </label>
            <input
              name="name"
              type="text"
              required
              autoFocus
              placeholder="Jane Smith"
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
            className="w-full py-2.5 rounded-lg bg-ih-primary text-white font-bold text-sm hover:bg-ih-primary-600 transition-colors"
          >
            Join Inspection
          </button>
        </Form>
      </div>
    </div>
  );
}
