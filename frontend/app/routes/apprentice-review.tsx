import { useState } from "react";
import { useLoaderData } from "react-router";
import type { Route } from "./+types/apprentice-review";
import { requireToken } from "~/lib/session.server";
import { apiFetch } from "~/lib/api.server";
import { PageHeader } from "@core/shared-ui";

export function meta() {
  return [{ title: "Apprentice Review - OpenInspection" }];
}

interface ReviewItem {
  id: string;
  apprenticeName: string;
  inspectionId: string;
  inspectionAddress: string | null;
  itemId: string;
  field: string;
  proposedValue: string | null;
  submittedAt: string;
  decision: string | null;
}

export async function loader({ request }: Route.LoaderArgs) {
  const token = await requireToken(request);
  try {
    const res = await apiFetch("/api/team/apprentice-reviews", { token });
    const body = res.ok ? ((await res.json()) as Record<string, unknown>) : { data: [] };
    return { items: (body.data ?? []) as ReviewItem[] };
  } catch {
    return { items: [] as ReviewItem[] };
  }
}

function initials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return (parts[0]?.[0] ?? "?").toUpperCase();
  return ((parts[0]?.[0] ?? "") + (parts[parts.length - 1]?.[0] ?? "")).toUpperCase();
}

function shortAddress(addr: string | null): string {
  if (!addr) return "No address";
  return addr.length > 30 ? addr.slice(0, 30) + "..." : addr;
}

export default function ApprenticeReviewPage() {
  const { items } = useLoaderData<typeof loader>();
  const [activeId, setActiveId] = useState<string | null>(items[0]?.id ?? null);

  const pendingCount = items.filter((i) => !i.decision).length;
  const active = items.find((i) => i.id === activeId) ?? null;

  return (
    <div className="space-y-[18px]">
      <PageHeader
        eyebrow="TEAM &middot; APPRENTICE REVIEW"
        eyebrowColor="slate"
        title="Apprentice Review"
        meta={`${pendingCount} pending ${pendingCount === 1 ? "review" : "reviews"}`}
      />

      {/* Status banner */}
      <div className={`flex items-center gap-3 px-4 py-3 rounded-md border ${
        pendingCount === 0
          ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800"
          : "bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800"
      }`}>
        <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-white shrink-0 ${
          pendingCount === 0 ? "bg-emerald-500" : "bg-indigo-500"
        }`}>
          {pendingCount === 0 ? <CheckIcon /> : <InfoIcon />}
        </span>
        <div>
          <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
            {pendingCount === 0 ? "All caught up" : `${pendingCount} apprentice ${pendingCount === 1 ? "rating" : "ratings"} awaiting review`}
          </p>
          <p className="text-[12px] text-slate-500 dark:text-slate-400">
            Items flow through here before they appear in the published report.
          </p>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
          <p className="font-semibold text-slate-700 dark:text-slate-200">Nothing to review</p>
          <p className="text-[13px] text-slate-500 mt-1">Apprentice ratings appear here when they are submitted.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4 min-h-[480px]">
          {/* Queue list */}
          <aside className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md overflow-hidden flex flex-col">
            <div className="px-4 py-3 flex items-center justify-between border-b border-slate-100 dark:border-slate-700">
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">Queue</span>
              <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
                {items.filter((i) => i.decision).length} / {items.length}
              </span>
            </div>
            <ul className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700">
              {items.map((q) => (
                <li key={q.id}>
                  <button
                    onClick={() => setActiveId(q.id)}
                    className={`w-full text-left px-4 py-3 flex items-start gap-3 transition-colors ${
                      q.id === activeId
                        ? "bg-indigo-50 dark:bg-indigo-900/30 border-l-[2px] border-indigo-500"
                        : "border-l-[2px] border-transparent hover:bg-slate-50 dark:hover:bg-slate-700/50"
                    }`}
                  >
                    <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 text-[10px] font-bold shrink-0">
                      {initials(q.apprenticeName)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400 dark:text-slate-500">
                        {q.field === "rating" ? "Rating" : q.field === "notes" ? "Notes" : "Value"}
                      </p>
                      <p className={`text-[13px] mt-0.5 leading-tight ${
                        q.id === activeId ? "text-indigo-700 dark:text-indigo-300 font-bold" : "text-slate-900 dark:text-slate-100 font-semibold"
                      }`}>{q.itemId}</p>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 truncate">
                        {shortAddress(q.inspectionAddress)}
                      </p>
                      {q.decision && (
                        <span className={`mt-1 inline-flex items-center gap-1 text-[10px] font-bold ${
                          q.decision === "approved" ? "text-emerald-600 dark:text-emerald-400"
                          : q.decision === "rejected" ? "text-rose-600 dark:text-rose-400"
                          : "text-indigo-600 dark:text-indigo-400"
                        }`}>
                          <CheckSmallIcon /> {q.decision === "approved" ? "Approved" : q.decision === "rejected" ? "Rejected" : "Edited"}
                        </span>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          {/* Review pane */}
          {active ? (
            <section className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md overflow-hidden flex flex-col">
              <header className="px-6 py-4 border-b border-slate-100 dark:border-slate-700">
                <div className="flex items-center gap-2 text-[12px] text-slate-600 dark:text-slate-300 mb-2">
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 text-[10px] font-bold">
                    {initials(active.apprenticeName)}
                  </span>
                  <span className="font-semibold">{active.apprenticeName}</span>
                  <span className="text-slate-400">submitted {active.submittedAt}</span>
                </div>
                <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">{active.itemId}</h2>
                <p className="text-[12px] text-slate-500 dark:text-slate-400 mt-1">Field: {active.field}</p>
              </header>

              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                <div className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-md p-4">
                  <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400 dark:text-slate-500 mb-2">Apprentice proposed</p>
                  <pre className="whitespace-pre-wrap text-sm text-slate-800 dark:text-slate-200 leading-relaxed">
                    {active.proposedValue || "—"}
                  </pre>
                </div>

                {active.decision && (
                  <div className={`px-4 py-3 rounded-md text-sm border ${
                    active.decision === "approved"
                      ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300"
                      : "bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300"
                  }`}>
                    Decision recorded: <span className="font-bold">{active.decision}</span>
                  </div>
                )}
              </div>

              {!active.decision && (
                <div className="border-t border-slate-100 dark:border-slate-700 px-6 py-4 flex items-center gap-3">
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 flex-1 max-w-[300px]">
                    Approve to publish as-is. Reject sends back to the apprentice.
                  </p>
                  <button className="px-3 py-2 rounded-md text-[12px] font-bold border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors">
                    Reject
                  </button>
                  <button className="px-4 py-2 rounded-md text-[12px] font-bold bg-emerald-500 hover:bg-emerald-600 text-white transition-colors inline-flex items-center gap-1.5">
                    <CheckSmallIcon /> Approve
                  </button>
                </div>
              )}
            </section>
          ) : (
            <div className="flex items-center justify-center bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md">
              <p className="text-[13px] text-slate-500">Select an item from the queue.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CheckIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0zM12 9v3.75M11.996 16.125h.007v.008h-.007v-.008z" />
    </svg>
  );
}

function CheckSmallIcon() {
  return (
    <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}
