import { useState } from "react";
import { Form, useLoaderData, useActionData } from "react-router";
import type { Route } from "./+types/concierge-book";
import { apiFetch } from "~/lib/api.server";
import { requireToken } from "~/lib/session.server";

export function meta() {
  return [{ title: "Book on behalf of client - OpenInspection" }];
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ConciergeBookData {
  inspector: {
    name: string | null;
    slug: string | null;
    contactId: string;
  };
  agent: { name: string | null };
  tenantId: string;
  tenantName: string;
}

/* ------------------------------------------------------------------ */
/*  Loader                                                             */
/* ------------------------------------------------------------------ */

export async function loader({ request, params }: Route.LoaderArgs) {
  const token = await requireToken(request);
  try {
    const res = await apiFetch(`/api/concierge/book-info`, { token });
    const body = res.ok ? await res.json() : {};
    const d = ((body as Record<string, unknown>).data ?? {}) as Record<string, unknown>;
    return { data: (Object.keys(d).length > 0 ? d : null) as ConciergeBookData | null, error: res.ok ? null : "Not found" };
  } catch {
    return { data: null, error: "Service unavailable" };
  }
}

/* ------------------------------------------------------------------ */
/*  Action                                                             */
/* ------------------------------------------------------------------ */

export async function action({ request }: Route.ActionArgs) {
  const token = await requireToken(request);
  const fd = await request.formData();
  const body = {
    tenantId: fd.get("tenantId"),
    inspectorContactId: fd.get("inspectorContactId"),
    clientName: fd.get("clientName"),
    clientEmail: fd.get("clientEmail"),
    clientPhone: fd.get("clientPhone") || undefined,
    propertyAddress: fd.get("propertyAddress"),
    date: fd.get("date"),
    timeSlot: fd.get("timeSlot"),
    agreementRequired: fd.get("agreementRequired") === "on",
    paymentRequired: fd.get("paymentRequired") === "on",
  };

  const res = await apiFetch("/api/concierge/book", {
    token,
    method: "POST",
    body: JSON.stringify(body),
  });

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || !json.success) {
    const err = json.error as Record<string, string> | undefined;
    return { success: false, error: err?.message || "Could not submit booking" };
  }
  return { success: true, error: null };
}

/* ------------------------------------------------------------------ */
/*  Timeline steps                                                     */
/* ------------------------------------------------------------------ */

const TIMELINE_STEPS = [
  { label: "Submitted", sub: "Booking sent.", done: true, active: false },
  { label: "Client confirms", sub: "Magic link sent -- waiting on the client.", done: false, active: true },
  { label: "Agreement signed", sub: "Client reads and e-signs the inspection agreement.", done: false, active: false },
  { label: "Inspection scheduled", sub: "You'll see it on your dashboard once locked in.", done: false, active: false },
];

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function ConciergeBookPage() {
  const { data, error: loaderError } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [submitting, setSubmitting] = useState(false);

  if (loaderError || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <p className="text-ih-fg-3">Could not load booking information.</p>
      </div>
    );
  }

  const inspectorName = data.inspector.name || data.inspector.slug || "this inspector";
  const agentName = data.agent.name || "Partner agent";
  const submitted = actionData?.success === true;

  return (
    <div className="min-h-screen bg-ih-bg-card">
      {/* Mode bar */}
      <div className="sticky top-0 z-50 bg-orange-50 dark:bg-orange-900/30 border-b border-orange-200 dark:border-orange-800/40 px-6 py-3 flex items-center justify-between text-sm font-semibold text-orange-800 dark:text-orange-300">
        <span className="flex items-center gap-2">
          <span className="text-lg" aria-hidden="true">🔔</span>
          <span>Booking on behalf of client</span>
        </span>
        <span className="text-[13px] text-orange-700 dark:text-orange-400">
          {agentName} &mdash; {data.tenantName}
        </span>
      </div>

      <main className="max-w-[720px] mx-auto px-5 py-10">
        <h1 className="font-serif text-[1.75rem] font-bold leading-tight mb-1 text-ih-fg-1">
          Book for <span className="text-ih-fg-3">{inspectorName}</span>
        </h1>
        <p className="text-[15px] text-ih-fg-3 leading-relaxed mb-7">
          Fill in your client's details and pick a date. They'll get an email to
          confirm and review the inspection agreement before anything is finalized.
        </p>

        {!submitted ? (
          <Form
            method="post"
            autoComplete="off"
            onSubmit={() => setSubmitting(true)}
            className="bg-ih-bg-card border border-ih-border rounded-xl p-7 space-y-4"
          >
            <input type="hidden" name="tenantId" value={data.tenantId} />
            <input type="hidden" name="inspectorContactId" value={data.inspector.contactId} />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="space-y-1.5">
                <span className="block text-[13px] font-bold text-ih-fg-3 uppercase tracking-wide">
                  Client name
                </span>
                <input
                  type="text"
                  name="clientName"
                  required
                  maxLength={200}
                  placeholder="Sarah Buyer"
                  className="w-full px-3 py-2.5 border border-ih-border rounded-lg bg-ih-bg-card text-base text-ih-fg-1 outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500"
                />
              </label>
              <label className="space-y-1.5">
                <span className="block text-[13px] font-bold text-ih-fg-3 uppercase tracking-wide">
                  Client email
                </span>
                <input
                  type="email"
                  name="clientEmail"
                  required
                  maxLength={200}
                  placeholder="sarah@example.com"
                  className="w-full px-3 py-2.5 border border-ih-border rounded-lg bg-ih-bg-card text-base text-ih-fg-1 outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500"
                />
              </label>
            </div>

            <label className="space-y-1.5 block">
              <span className="block text-[13px] font-bold text-ih-fg-3 uppercase tracking-wide">
                Client phone{" "}
                <span className="text-ih-fg-4 font-medium normal-case tracking-normal">
                  (optional)
                </span>
              </span>
              <input
                type="tel"
                name="clientPhone"
                maxLength={40}
                placeholder="(555) 123-4567"
                className="w-full px-3 py-2.5 border border-ih-border rounded-lg bg-ih-bg-card text-base text-ih-fg-1 outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500"
              />
            </label>

            <label className="space-y-1.5 block">
              <span className="block text-[13px] font-bold text-ih-fg-3 uppercase tracking-wide">
                Property address
              </span>
              <input
                type="text"
                name="propertyAddress"
                required
                maxLength={500}
                placeholder="1 Main St, Springfield"
                className="w-full px-3 py-2.5 border border-ih-border rounded-lg bg-ih-bg-card text-base text-ih-fg-1 outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500"
              />
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="space-y-1.5">
                <span className="block text-[13px] font-bold text-ih-fg-3 uppercase tracking-wide">
                  Date
                </span>
                <input
                  type="date"
                  name="date"
                  required
                  className="w-full px-3 py-2.5 border border-ih-border rounded-lg bg-ih-bg-card text-base text-ih-fg-1 outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500"
                />
              </label>
              <label className="space-y-1.5">
                <span className="block text-[13px] font-bold text-ih-fg-3 uppercase tracking-wide">
                  Time slot
                </span>
                <select
                  name="timeSlot"
                  required
                  className="w-full px-3 py-2.5 border border-ih-border rounded-lg bg-ih-bg-card text-base text-ih-fg-1 outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500"
                >
                  <option value="">Select a slot</option>
                  <option value="08:00">8:00 AM</option>
                  <option value="09:00">9:00 AM</option>
                  <option value="10:00">10:00 AM</option>
                  <option value="11:00">11:00 AM</option>
                  <option value="13:00">1:00 PM</option>
                  <option value="14:00">2:00 PM</option>
                  <option value="15:00">3:00 PM</option>
                </select>
              </label>
            </div>

            <div className="space-y-2.5">
              <label className="flex items-center gap-2.5 px-3 py-2.5 border border-ih-border rounded-lg text-[14px] text-ih-fg-3 font-medium">
                <input type="checkbox" name="agreementRequired" defaultChecked />
                Inspector requires the client to e-sign an inspection agreement
              </label>
              <label className="flex items-center gap-2.5 px-3 py-2.5 border border-ih-border rounded-lg text-[14px] text-ih-fg-3 font-medium">
                <input type="checkbox" name="paymentRequired" />
                Inspector requires payment before the inspection
              </label>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={submitting}
                className="w-full px-6 py-3.5 bg-[#F55A1A] text-white rounded-lg font-bold text-base hover:brightness-95 disabled:bg-slate-400 disabled:cursor-wait transition-all"
              >
                {submitting ? "Sending..." : "Send booking to client"}
              </button>

              {actionData?.error && (
                <div className="mt-3 px-4 py-3 bg-ih-bad-bg border border-ih-bad rounded-lg text-[14px] text-ih-bad-fg">
                  {actionData.error}
                </div>
              )}
            </div>
          </Form>
        ) : (
          /* Post-submit timeline */
          <div className="bg-ih-bg-card border border-ih-border rounded-xl p-7 space-y-3.5 mt-5">
            {TIMELINE_STEPS.map((step, idx) => (
              <div key={step.label} className="flex items-center gap-3 py-2.5">
                <span
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                    step.done
                      ? "bg-green-500 text-white"
                      : step.active
                        ? "bg-[#F55A1A] text-white animate-pulse"
                        : "bg-ih-bg-muted text-ih-fg-3"
                  }`}
                >
                  {step.done ? "✓" : idx + 1}
                </span>
                <div>
                  <div className="text-[15px] font-semibold text-ih-fg-1">
                    {step.label}
                  </div>
                  <div className="text-[13px] text-ih-fg-3 mt-0.5">
                    {step.sub}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
