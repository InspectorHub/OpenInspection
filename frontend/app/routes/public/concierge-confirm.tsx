import { useState } from "react";
import { Form, useLoaderData, useActionData } from "react-router";
import type { Route } from "./+types/concierge-confirm";
import { apiFetch } from "~/lib/api.server";

export function meta() {
  return [{ title: "Confirm your inspection - OpenInspection" }];
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ConfirmData {
  token: string;
  inspector: {
    name: string | null;
    photoUrl: string | null;
    email: string | null;
  };
  inspection: {
    propertyAddress: string;
    date: string;
    clientName: string | null;
    agreementRequired: boolean;
  };
  agreementSnippet?: string;
}

/* ------------------------------------------------------------------ */
/*  Loader                                                             */
/* ------------------------------------------------------------------ */

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  if (!token) {
    return { data: null, error: "no-token" as const };
  }
  try {
    const res = await apiFetch(
      `/api/concierge/confirm-info?token=${encodeURIComponent(token)}`,
    );
    const body = res.ok ? await res.json() : {};
    if (!res.ok) {
      return { data: null, error: "expired" as const };
    }
    const d = ((body as Record<string, unknown>).data ?? {}) as unknown as ConfirmData | undefined;
    return { data: d && Object.keys(d).length > 0 ? { ...d, token } : null, error: null };
  } catch {
    return { data: null, error: "unknown" as const };
  }
}

/* ------------------------------------------------------------------ */
/*  Action                                                             */
/* ------------------------------------------------------------------ */

export async function action({ request }: Route.ActionArgs) {
  const fd = await request.formData();
  const token = fd.get("token") as string;

  const res = await apiFetch("/api/concierge/confirm", {
    method: "POST",
    body: JSON.stringify({ token }),
  });

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.ok && json.success) {
    const data = json.data as Record<string, string> | undefined;
    return { error: null, redirect: data?.redirect || "/" };
  }
  const err = json.error as Record<string, string> | undefined;
  return { error: err?.message || "Could not confirm. Please try again.", redirect: null };
}

/* ------------------------------------------------------------------ */
/*  Helper                                                             */
/* ------------------------------------------------------------------ */

function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return (parts[0]?.[0] ?? "?").toUpperCase();
  return (
    (parts[0]?.[0] ?? "") + (parts[parts.length - 1]?.[0] ?? "")
  ).toUpperCase();
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function ConciergeConfirmPage() {
  const { data, error: loaderError } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [submitting, setSubmitting] = useState(false);

  // Redirect on success
  if (typeof window !== "undefined" && actionData?.redirect) {
    window.location.href = actionData.redirect;
  }

  // Error / expired states
  if (loaderError || !data) {
    const headline =
      loaderError === "expired"
        ? "This confirmation link has expired"
        : loaderError === "no-token"
          ? "No confirmation link provided"
          : "We couldn't find that confirmation link";
    const body =
      loaderError === "expired"
        ? "Confirmation links are valid for 7 days. Reach out to your agent or inspector and they can send you a fresh one."
        : loaderError === "no-token"
          ? "It looks like the link is incomplete. Use the original email and try again, or contact your agent."
          : "The link may have been mistyped, or the booking was cancelled. Get in touch with your agent.";
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-[480px] w-full bg-ih-bg-card border border-ih-border rounded-xl p-9">
          <div className="w-12 h-12 rounded-xl bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 flex items-center justify-center text-2xl font-bold mb-4">
            !
          </div>
          <h1 className="font-serif text-2xl font-bold mb-2 text-ih-fg-1">
            {headline}
          </h1>
          <p className="text-[15px] text-ih-fg-3 leading-relaxed">
            {body}
          </p>
        </div>
      </div>
    );
  }

  const inspectorName = data.inspector.name || data.inspector.email || "your inspector";

  return (
    <div className="min-h-screen bg-ih-bg-card">
      <main className="max-w-[640px] mx-auto px-5 py-10">
        {/* Brand */}
        <div className="flex items-center gap-2.5 font-serif text-lg font-bold mb-10 text-ih-fg-1">
          <span className="w-8 h-8 rounded-lg bg-[#F55A1A] text-white flex items-center justify-center font-bold text-sm">
            O
          </span>
          <span>OpenInspection</span>
        </div>

        <h1 className="font-serif text-[2rem] font-bold leading-tight mb-2 text-ih-fg-1">
          Confirm your inspection
        </h1>
        <p className="text-base text-ih-fg-3 leading-relaxed mb-8">
          {data.inspector.name ? (
            <strong className="text-ih-fg-1">
              {data.inspector.name}
            </strong>
          ) : (
            "Your inspector"
          )}{" "}
          has scheduled an inspection on your behalf. Review the details below
          and confirm to lock it in.
        </p>

        {/* Summary card */}
        <article className="bg-ih-bg-card border border-ih-border rounded-xl overflow-hidden mb-6">
          <div className="flex items-center gap-4 p-7 border-b border-ih-border">
            {data.inspector.photoUrl ? (
              <span className="w-[72px] h-[72px] rounded-full overflow-hidden shrink-0 bg-orange-50 dark:bg-orange-900/20">
                <img
                  src={data.inspector.photoUrl}
                  alt={inspectorName}
                  className="w-full h-full object-cover"
                />
              </span>
            ) : (
              <span className="w-[72px] h-[72px] rounded-full bg-orange-50 dark:bg-orange-900/20 text-[#F55A1A] flex items-center justify-center font-serif font-bold text-2xl shrink-0">
                {initials(data.inspector.name)}
              </span>
            )}
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-ih-fg-4 mb-1">
                Your inspector
              </div>
              <div className="font-serif text-2xl font-bold text-ih-fg-1 leading-tight">
                {inspectorName}
              </div>
            </div>
          </div>
          <div className="p-6 space-y-3.5">
            <div>
              <span className="block text-[11px] font-bold uppercase tracking-[0.12em] text-ih-fg-4">
                Property
              </span>
              <span className="text-base font-semibold text-ih-fg-1">
                {data.inspection.propertyAddress}
              </span>
            </div>
            <div>
              <span className="block text-[11px] font-bold uppercase tracking-[0.12em] text-ih-fg-4">
                Date
              </span>
              <span className="text-base font-semibold text-ih-fg-1">
                {data.inspection.date}
              </span>
            </div>
            {data.inspection.clientName && (
              <div>
                <span className="block text-[11px] font-bold uppercase tracking-[0.12em] text-ih-fg-4">
                  Client
                </span>
                <span className="text-base font-semibold text-ih-fg-1">
                  {data.inspection.clientName}
                </span>
              </div>
            )}
          </div>
        </article>

        {/* Agreement preview */}
        {data.inspection.agreementRequired && data.agreementSnippet && (
          <section className="bg-ih-bg-card border border-ih-border rounded-xl p-6 mb-6">
            <h3 className="font-serif text-lg font-bold text-ih-fg-1 mb-2">
              Inspection agreement (preview)
            </h3>
            <p className="text-[15px] italic text-ih-fg-3 leading-relaxed">
              {data.agreementSnippet}
            </p>
            <p className="mt-3.5 text-[13px] text-ih-fg-4">
              After confirming you'll be taken to the full agreement to read and e-sign.
            </p>
          </section>
        )}
        {data.inspection.agreementRequired && !data.agreementSnippet && (
          <section className="bg-ih-bg-card border border-ih-border rounded-xl p-6 mb-6">
            <h3 className="font-serif text-lg font-bold text-ih-fg-1 mb-2">
              Inspection agreement
            </h3>
            <p className="text-[15px] italic text-ih-fg-3 leading-relaxed">
              After confirming you'll be taken to the full inspection agreement to read and e-sign.
            </p>
          </section>
        )}

        {/* Confirm form */}
        <Form method="post" onSubmit={() => setSubmitting(true)} className="mt-7">
          <input type="hidden" name="token" value={data.token} />
          <button
            type="submit"
            disabled={submitting}
            className="w-full px-6 py-4 bg-[#F55A1A] text-white rounded-lg font-bold text-base hover:brightness-95 disabled:bg-slate-400 disabled:cursor-wait transition-all"
          >
            {submitting ? "Confirming..." : "Confirm and continue"}
          </button>
          {actionData?.error && (
            <div className="mt-3 px-4 py-3 bg-ih-bad-bg border border-ih-bad rounded-lg text-[14px] text-ih-bad-fg">
              {actionData.error}
            </div>
          )}
        </Form>
      </main>
    </div>
  );
}
