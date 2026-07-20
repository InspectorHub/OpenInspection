import { Form, useLoaderData, useNavigation, redirect } from "react-router";
import type { Route } from "./+types/concierge-confirm-token";
import { createApi } from "~/lib/api-client.server";
import { formatInspectionDateTime } from "~/lib/format-date";
import { ErrorState } from "~/components/ErrorState";
import { ViewerTimeZoneProvider, useViewerTimeZone } from "~/lib/viewer-timezone";
import { ViewerTimeZoneNotice } from "~/components/public/ViewerTimeZoneNotice";
import { m } from "~/paraglide/messages";

export function meta() {
  return [{ title: m.concierge_confirm_meta_title() }];
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
  if (!token) return { view: null as ConfirmView | null, status: "not-found" as const, date: null };
  try {
    const api = createApi(context);
    const res = await api.concierge["confirm-view"].$get({ query: { token } });
    if (!res.ok) return { view: null, status: "not-found" as const, date: null };
    const body = (await res.json()) as { success: boolean; data?: ConfirmView };
    if (!body.success || !body.data) return { view: null, status: "not-found" as const, date: null };
    const view = body.data;
    // This magic-link surface carries no tenant slug and no session, so there is
    // no configured zone to anchor to. Return the raw date; the confirm card
    // renders it in the viewer's own browser zone (see <ViewerTimeZoneProvider>).
    const date = view.inspection.date;
    if (view.expired) return { view, status: "expired" as const, date };
    if (view.alreadyConfirmed) return { view, status: "already" as const, date };
    return { view, status: "ok" as const, date };
  } catch {
    return { view: null, status: "error" as const, date: null };
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

function ConciergeConfirmBody() {
  const { view, status, date } = useLoaderData<typeof loader>();
  const tz = useViewerTimeZone();
  const displayDate = date ? formatInspectionDateTime(date, undefined, tz) : date;
  const nav = useNavigation();
  const submitting = nav.state === "submitting";

  if (status === "not-found" || status === "error" || !view) {
    return (
      <ErrorState
        title={m.concierge_confirm_error_unavailable_title()}
        message={m.concierge_confirm_error_unavailable_body()}
      />
    );
  }

  if (status === "expired") {
    return (
      <ErrorState
        title={m.concierge_confirm_expired_title()}
        message={m.concierge_confirm_expired_body()}
      />
    );
  }

  if (status === "already") {
    return (
      <ErrorState
        title={m.concierge_confirm_already_title()}
        message={m.concierge_confirm_already_body()}
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
          {m.concierge_confirm_heading()}
        </h1>
        <p className="text-[15px] text-ih-fg-3 leading-relaxed mb-5">
          {view.inspection.clientName ? m.concierge_confirm_greeting_named({ clientName: view.inspection.clientName }) : m.concierge_confirm_greeting_anon()}{m.concierge_confirm_greeting_rest()}
        </p>

        <dl className="text-sm border border-ih-border rounded-lg divide-y divide-ih-border mb-6">
          <div className="flex justify-between gap-4 px-4 py-3">
            <dt className="text-ih-fg-4">{m.concierge_confirm_label_property()}</dt>
            <dd className="text-ih-fg-1 font-medium text-right">{view.inspection.propertyAddress}</dd>
          </div>
          <div className="flex justify-between gap-4 px-4 py-3">
            <dt className="text-ih-fg-4">{m.concierge_confirm_label_date()}</dt>
            <dd className="text-ih-fg-1 font-medium text-right">{displayDate}</dd>
          </div>
          {view.inspector?.name && (
            <div className="flex justify-between gap-4 px-4 py-3">
              <dt className="text-ih-fg-4">{m.concierge_confirm_label_inspector()}</dt>
              <dd className="text-ih-fg-1 font-medium text-right">{view.inspector.name}</dd>
            </div>
          )}
        </dl>

        {view.inspection.agreementRequired && (
          <p className="text-[13px] text-ih-fg-4 mb-4">
            {m.concierge_confirm_agreement_notice()}
          </p>
        )}

        <Form method="post">
          <button
            type="submit"
            disabled={submitting}
            className="w-full h-11 rounded-lg bg-ih-primary text-white text-sm font-bold hover:bg-ih-primary-600 transition-colors disabled:opacity-60"
          >
            {submitting ? m.concierge_confirm_submit_pending() : m.concierge_confirm_submit()}
          </button>
        </Form>

        {view.inspection.date && <ViewerTimeZoneNotice className="mt-5" />}
      </main>
    </div>
  );
}

export default function ConciergeConfirmTokenPage() {
  return (
    <ViewerTimeZoneProvider>
      <ConciergeConfirmBody />
    </ViewerTimeZoneProvider>
  );
}
