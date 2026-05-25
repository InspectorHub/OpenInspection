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
    const json = res.ok ? ((await res.json()) as Record<string, unknown>) : {};
    if (!res.ok) {
      return { invite: null, error: "expired" as const };
    }
    const data = json.data as InviteData | undefined;
    return {
      invite: data ? { ...data, token } : null,
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
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-slate-900 p-6">
        <div className="max-w-md text-center">
          <h1 className="font-serif text-2xl font-bold mb-3 text-slate-900 dark:text-slate-100">
            Invite unavailable
          </h1>
          <p className="text-[15px] text-slate-500 dark:text-slate-400 mb-6">
            This invite link is expired, already used, or invalid.
          </p>
          <a
            href="/agent-signup"
            className="inline-block px-6 py-3 bg-indigo-600 text-white rounded-xl font-semibold hover:opacity-90 transition-opacity"
          >
            Sign up directly instead
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white dark:bg-slate-900">
      <div className="max-w-[540px] mx-auto px-6 py-14">
        {/* Brand */}
        <div className="flex items-center gap-3 mb-10">
          <img src="/logo.svg" alt="" className="w-8 h-8" />
          <span className="font-serif font-bold text-lg tracking-tight text-slate-900 dark:text-slate-100">
            OpenInspection
          </span>
        </div>

        <h1 className="font-serif font-bold text-4xl leading-tight tracking-tight mb-3 text-slate-900 dark:text-slate-100">
          You're invited
        </h1>
        <p className="text-base text-slate-500 dark:text-slate-400 leading-relaxed mb-9">
          <strong className="text-slate-900 dark:text-slate-100">
            {invite.inspector.name}
          </strong>{" "}
          at{" "}
          <strong className="text-slate-900 dark:text-slate-100">
            {invite.tenantName}
          </strong>{" "}
          has invited you to be a partner agent. See every inspection your
          inspectors complete for the clients you refer.
        </p>

        {/* Inspector hero band */}
        <div className="flex items-center gap-4 p-5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl mb-8">
          <div className="w-14 h-14 rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-serif font-bold text-xl shrink-0 overflow-hidden">
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
            <div className="font-semibold text-base text-slate-900 dark:text-slate-100">
              {invite.inspector.name}
            </div>
            <div className="text-[14px] text-slate-500 dark:text-slate-400 mt-0.5">
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
              className="p-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-center"
            >
              <div className="text-2xl mb-2">{v.icon}</div>
              <div className="text-[13px] font-semibold text-slate-900 dark:text-slate-100 leading-snug">
                {v.title}
              </div>
              <div className="text-[12px] text-slate-500 dark:text-slate-400 mt-1">
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
                className="block text-[13px] font-semibold text-slate-600 dark:text-slate-400 mb-2"
              >
                Email
              </label>
              <input
                type="email"
                id="email"
                name="email"
                value={invite.inviteEmail}
                readOnly
                className="w-full px-4 py-3 text-[15px] bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl text-slate-500 dark:text-slate-400 cursor-not-allowed"
              />
            </div>
            <div>
              <label
                htmlFor="name"
                className="block text-[13px] font-semibold text-slate-600 dark:text-slate-400 mb-2"
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
                className="w-full px-4 py-3 text-[15px] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label
                htmlFor="password"
                className="block text-[13px] font-semibold text-slate-600 dark:text-slate-400 mb-2"
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
                className="w-full px-4 py-3 text-[15px] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full mt-7 px-6 py-3.5 text-[15px] font-semibold text-white bg-indigo-600 rounded-xl hover:opacity-90 active:scale-[0.985] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {submitting ? "Setting up your account..." : "Accept invitation"}
          </button>

          {actionData?.error && (
            <div className="mt-4 px-4 py-3 rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 text-[14px] text-rose-700 dark:text-rose-300">
              {actionData.error}
            </div>
          )}
        </Form>

        <p className="mt-10 text-xs text-slate-400 dark:text-slate-500 text-center leading-relaxed">
          By accepting you agree to receive notifications when your referrals
          are inspected. You can unsubscribe at any time.
        </p>
      </div>
    </div>
  );
}
