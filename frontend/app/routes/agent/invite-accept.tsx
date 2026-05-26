import { useState } from "react";
import { Form, useLoaderData, useActionData } from "react-router";
import type { Route } from "./+types/invite-accept";
import { apiFetch } from "~/lib/api.server";

export function meta() {
  return [{ title: "You're invited - OpenInspection" }];
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface InviteData {
  token: string;
  inspector: { name: string; photoUrl?: string };
  tenantName: string;
  inviteEmail: string;
}

/* ------------------------------------------------------------------ */
/*  Loader                                                             */
/* ------------------------------------------------------------------ */

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  if (!token) {
    return { invite: null, error: "no-token" as const };
  }
  try {
    const res = await apiFetch(`/api/agents/invite-info?token=${encodeURIComponent(token)}`);
    const body = res.ok ? await res.json() : {};
    if (!res.ok) {
      return { invite: null, error: "expired" as const };
    }
    const data = ((body as Record<string, unknown>).data ?? {}) as unknown as InviteData | undefined;
    return {
      invite: data && Object.keys(data).length > 0 ? { ...data, token } : null,
      error: null,
    };
  } catch {
    return { invite: null, error: "unknown" as const };
  }
}

/* ------------------------------------------------------------------ */
/*  Action                                                             */
/* ------------------------------------------------------------------ */

export async function action({ request }: Route.ActionArgs) {
  const fd = await request.formData();
  const body = {
    token: fd.get("token"),
    password: fd.get("password"),
    name: fd.get("name"),
  };

  const res = await apiFetch("/api/agents/accept", {
    method: "POST",
    body: JSON.stringify(body),
  });

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || !json.success) {
    const err = json.error as Record<string, string> | undefined;
    return { error: err?.message || "Could not accept invite", redirect: null };
  }

  const data = json.data as Record<string, string> | undefined;
  return { error: null, redirect: data?.redirect || "/agent-dashboard" };
}

/* ------------------------------------------------------------------ */
/*  Helper                                                             */
/* ------------------------------------------------------------------ */

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 2);
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function AgentInviteAcceptPage() {
  const { invite, error: loaderError } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [submitting, setSubmitting] = useState(false);

  // Redirect on success
  if (typeof window !== "undefined" && actionData?.redirect) {
    window.location.href = actionData.redirect;
  }

  // Invite expired / missing -- redirect to expired page
  if (loaderError || !invite) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ih-bg-card p-6">
        <div className="max-w-md text-center">
          <h1 className="font-serif text-2xl font-bold mb-3 text-ih-fg-1">
            Invite unavailable
          </h1>
          <p className="text-[15px] text-ih-fg-3 mb-6">
            This invite link is expired, already used, or invalid.
          </p>
          <a
            href="/agent-signup"
            className="inline-block px-6 py-3 bg-ih-primary text-white rounded-xl font-semibold hover:opacity-90 transition-opacity"
          >
            Sign up directly instead
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ih-bg-card">
      <div className="max-w-[540px] mx-auto px-6 py-14">
        {/* Brand */}
        <div className="flex items-center gap-3 mb-10">
          <img src="/logo.svg" alt="" className="w-8 h-8" />
          <span className="font-serif font-bold text-lg tracking-tight text-ih-fg-1">
            OpenInspection
          </span>
        </div>

        <h1 className="font-serif font-bold text-4xl leading-tight tracking-tight mb-3 text-ih-fg-1">
          You're invited
        </h1>
        <p className="text-base text-ih-fg-3 leading-relaxed mb-9">
          <strong className="text-ih-fg-1">
            {invite.inspector.name}
          </strong>{" "}
          at{" "}
          <strong className="text-ih-fg-1">
            {invite.tenantName}
          </strong>{" "}
          has invited you to be a partner agent. See every inspection your
          inspectors complete for the clients you refer.
        </p>

        {/* Inspector hero band */}
        <div className="flex items-center gap-4 p-5 bg-ih-bg-card border border-ih-border rounded-2xl mb-8">
          <div className="w-14 h-14 rounded-full bg-ih-primary-tint text-ih-primary flex items-center justify-center font-serif font-bold text-xl shrink-0 overflow-hidden">
            {invite.inspector.photoUrl ? (
              <img
                src={invite.inspector.photoUrl}
                alt={invite.inspector.name}
                className="w-full h-full object-cover rounded-full"
              />
            ) : (
              getInitials(invite.inspector.name)
            )}
          </div>
          <div>
            <div className="font-semibold text-base text-ih-fg-1">
              {invite.inspector.name}
            </div>
            <div className="text-[14px] text-ih-fg-3 mt-0.5">
              {invite.tenantName}
            </div>
          </div>
        </div>

        {/* Value props */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-9">
          {[
            { icon: "↗", title: "Real-time referrals", sub: "See reports the moment they're ready" },
            { icon: "⊕", title: "Cross-tenant view", sub: "All your inspectors, one dashboard" },
            { icon: "★", title: "Free", sub: "No fees, no card on file" },
          ].map((v) => (
            <div
              key={v.title}
              className="p-4 bg-ih-bg-card border border-ih-border rounded-xl text-center"
            >
              <div className="text-2xl mb-2">{v.icon}</div>
              <div className="text-[13px] font-semibold text-ih-fg-1 leading-snug">
                {v.title}
              </div>
              <div className="text-[12px] text-ih-fg-3 mt-1">
                {v.sub}
              </div>
            </div>
          ))}
        </div>

        {/* Accept form */}
        <Form method="post" autoComplete="off" onSubmit={() => setSubmitting(true)}>
          <input type="hidden" name="token" value={invite.token} />

          <div className="space-y-5">
            <div>
              <label
                htmlFor="email"
                className="block text-[13px] font-semibold text-ih-fg-3 mb-2"
              >
                Email
              </label>
              <input
                type="email"
                id="email"
                name="email"
                value={invite.inviteEmail}
                readOnly
                className="w-full px-4 py-3 text-[15px] bg-ih-bg-muted border border-ih-border rounded-xl text-ih-fg-3 cursor-not-allowed"
              />
            </div>
            <div>
              <label
                htmlFor="name"
                className="block text-[13px] font-semibold text-ih-fg-3 mb-2"
              >
                Your full name
              </label>
              <input
                type="text"
                id="name"
                name="name"
                placeholder="Jane Smith"
                required
                minLength={2}
                className="w-full px-4 py-3 text-[15px] bg-ih-bg-card border border-ih-border rounded-xl outline-none focus:border-indigo-500 focus:shadow-ih-focus transition-all text-ih-fg-1"
              />
            </div>
            <div>
              <label
                htmlFor="password"
                className="block text-[13px] font-semibold text-ih-fg-3 mb-2"
              >
                Create a password
              </label>
              <input
                type="password"
                id="password"
                name="password"
                placeholder="At least 12 characters"
                required
                minLength={12}
                className="w-full px-4 py-3 text-[15px] bg-ih-bg-card border border-ih-border rounded-xl outline-none focus:border-indigo-500 focus:shadow-ih-focus transition-all text-ih-fg-1"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full mt-7 px-6 py-3.5 text-[15px] font-semibold text-white bg-ih-primary rounded-xl hover:opacity-90 active:scale-[0.985] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {submitting ? "Setting up your account..." : "Accept invitation"}
          </button>

          {actionData?.error && (
            <div className="mt-4 px-4 py-3 rounded-lg bg-ih-bad-bg border border-ih-bad text-[14px] text-ih-bad-fg">
              {actionData.error}
            </div>
          )}
        </Form>

        <p className="mt-10 text-xs text-ih-fg-4 text-center leading-relaxed">
          By accepting you agree to receive notifications when your referrals
          are inspected. You can unsubscribe at any time.
        </p>
      </div>
    </div>
  );
}
