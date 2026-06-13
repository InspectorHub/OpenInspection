import { Form, useLoaderData, useNavigation, redirect } from "react-router";
import type { Route } from "./+types/concierge-confirm-token";
import { createApi } from "~/lib/api-client.server";
import { ErrorState } from "~/components/ErrorState";

export function meta() {
  return [{ title: "Confirm your inspection - OpenInspection" }];
}

interface ConfirmView {
  inspection: {
    propertyAddress: string;
    date: string;
    clientName: string | null;
    agreementRequired: boolean;
  };
  inspector: { name: string | null; photoUrl: string | null } | null;
  expired: boolean;
  alreadyConfirmed: boolean;
}

/* ------------------------------------------------------------------ */
/*  Loader — read the token view                                       */
/* ------------------------------------------------------------------ */

export async function loader({ params, context }: Route.LoaderArgs) {
  const token = params.token ?? "";
  if (!token) return { view: null as ConfirmView | null, status: "not-found" as const };
  try {
    const api = createApi(context);
    const res = await api.concierge["confirm-view"].$get({ query: { token } });
    if (!res.ok) return { view: null, status: "not-found" as const };
    const body = (await res.json()) as { success: boolean; data?: ConfirmView };
    if (!body.success || !body.data) return { view: null, status: "not-found" as const };
    const view = body.data;
    if (view.expired) return { view, status: "expired" as const };
    if (view.alreadyConfirmed) return { view, status: "already" as const };
    return { view, status: "ok" as const };
  } catch {
    return { view: null, status: "error" as const };
  }
}

/* ------------------------------------------------------------------ */
/*  Action — redeem the token, follow the server redirect              */
/* ------------------------------------------------------------------ */

export async function action({ params, context }: Route.ActionArgs) {
  const token = params.token ?? "";
  const api = createApi(context);
  const res = await api.concierge.confirm.$post({ json: { token } });
  if (!res.ok) {
    return { ok: false as const };
  }
  const body = (await res.json()) as { success: boolean; data?: { redirect?: string } };
  return redirect(body.data?.redirect || "/");
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function ConciergeConfirmTokenPage() {
  const { view, status } = useLoaderData<typeof loader>();
  const nav = useNavigation();
  const submitting = nav.state === "submitting";

  if (status === "not-found" || status === "error" || !view) {
    return (
      <ErrorState
        title="Confirmation link unavailable"
        message="This link may have been mistyped or the booking was cancelled. Contact your agent for a fresh confirmation link."
      />
    );
  }

  if (status === "expired") {
    return (
      <ErrorState
        title="This confirmation link has expired"
        message="Confirmation links are valid for 7 days. Your agent or inspector can send you a fresh one in a minute."
      />
    );
  }

  if (status === "already") {
    return (
      <ErrorState
        title="Already confirmed"
        message="This inspection has already been confirmed. You're all set — your inspector has the details."
      />
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-ih-bg-card">
      <main className="max-w-[480px] w-full bg-ih-bg-card border border-ih-border rounded-xl p-9">
        <div className="w-12 h-12 rounded-xl bg-ih-primary-tint text-ih-primary flex items-center justify-center mb-4">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h1 className="font-serif text-2xl font-bold leading-tight mb-2.5 text-ih-fg-1">
          Confirm your inspection
        </h1>
        <p className="text-[15px] text-ih-fg-3 leading-relaxed mb-5">
          {view.inspection.clientName ? `Hi ${view.inspection.clientName}, please` : "Please"} review and confirm
          the details below.
        </p>

        <dl className="text-sm border border-ih-border rounded-lg divide-y divide-ih-border mb-6">
          <div className="flex justify-between gap-4 px-4 py-3">
            <dt className="text-ih-fg-4">Property</dt>
            <dd className="text-ih-fg-1 font-medium text-right">{view.inspection.propertyAddress}</dd>
          </div>
          <div className="flex justify-between gap-4 px-4 py-3">
            <dt className="text-ih-fg-4">Date</dt>
            <dd className="text-ih-fg-1 font-medium text-right">{view.inspection.date}</dd>
          </div>
          {view.inspector?.name && (
            <div className="flex justify-between gap-4 px-4 py-3">
              <dt className="text-ih-fg-4">Inspector</dt>
              <dd className="text-ih-fg-1 font-medium text-right">{view.inspector.name}</dd>
            </div>
          )}
        </dl>

        {view.inspection.agreementRequired && (
          <p className="text-[13px] text-ih-fg-4 mb-4">
            After confirming, you'll be taken to sign the inspection agreement.
          </p>
        )}

        <Form method="post">
          <button
            type="submit"
            disabled={submitting}
            className="w-full h-11 rounded-lg bg-ih-primary text-white text-sm font-bold hover:bg-ih-primary-600 transition-colors disabled:opacity-60"
          >
            {submitting ? "Confirming…" : "Confirm inspection"}
          </button>
        </Form>
      </main>
    </div>
  );
}
