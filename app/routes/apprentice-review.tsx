import { useState } from "react";
import { useLoaderData } from "react-router";
import type { Route } from "./+types/apprentice-review";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
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

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  try {
    const api = createApi(context, { token });
    const res = await api.team["apprentice-reviews"].$get();
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
          ? "bg-ih-ok-bg border-ih-ok/30"
          : "bg-ih-primary-tint border-ih-primary/30"
      }`}>
        <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-white shrink-0 ${
          pendingCount === 0 ? "bg-ih-ok" : "bg-ih-primary"
        }`}>
          {pendingCount === 0 ? <CheckIcon /> : <InfoIcon />}
        </span>
        <div>
          <p className="text-sm font-bold text-ih-fg-1">
            {pendingCount === 0 ? "All caught up" : `${pendingCount} apprentice ${pendingCount === 1 ? "rating" : "ratings"} awaiting review`}
          </p>
          <p className="text-[12px] text-ih-fg-3">
            Items flow through here before they appear in the published report.
          </p>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="text-center py-16 bg-ih-bg-card rounded-lg border border-ih-border">
          <p className="font-semibold text-ih-fg-2">Nothing to review</p>
          <p className="text-[13px] text-ih-fg-3 mt-1">Apprentice ratings appear here when they are submitted.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4 min-h-[480px]">
          {/* Queue list */}
          <aside className="bg-ih-bg-card border border-ih-border rounded-md overflow-hidden flex flex-col">
            <div className="px-4 py-3 flex items-center justify-between border-b border-ih-border">
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-ih-fg-4">Queue</span>
              <span className="text-[10px] font-mono text-ih-fg-4">
                {items.filter((i) => i.decision).length} / {items.length}
              </span>
            </div>
            <ul className="flex-1 overflow-y-auto divide-y divide-ih-border">
              {items.map((q) => (
                <li key={q.id}>
                  <button
                    onClick={() => setActiveId(q.id)}
                    className={`w-full text-left px-4 py-3 flex items-start gap-3 transition-colors ${
                      q.id === activeId
                        ? "bg-ih-primary-tint border-l-[2px] border-ih-primary"
                        : "border-l-[2px] border-transparent hover:bg-ih-bg-muted"
                    }`}
                  >
                    <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-ih-bad-bg text-ih-bad-fg text-[10px] font-bold shrink-0">
                      {initials(q.apprenticeName)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-ih-fg-4">
                        {q.field === "rating" ? "Rating" : q.field === "notes" ? "Notes" : "Value"}
                      </p>
                      <p className={`text-[13px] mt-0.5 leading-tight ${
                        q.id === activeId ? "text-ih-primary font-bold" : "text-ih-fg-1 font-semibold"
                      }`}>{q.itemId}</p>
                      <p className="text-[10px] text-ih-fg-3 mt-1 truncate">
                        {shortAddress(q.inspectionAddress)}
                      </p>
                      {q.decision && (
                        <span className={`mt-1 inline-flex items-center gap-1 text-[10px] font-bold ${
                          q.decision === "approved" ? "text-ih-ok-fg"
                          : q.decision === "rejected" ? "text-ih-bad-fg"
                          : "text-ih-primary"
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
            <section className="bg-ih-bg-card border border-ih-border rounded-md overflow-hidden flex flex-col">
              <header className="px-6 py-4 border-b border-ih-border">
                <div className="flex items-center gap-2 text-[12px] text-ih-fg-2 mb-2">
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-ih-bad-bg text-ih-bad-fg text-[10px] font-bold">
                    {initials(active.apprenticeName)}
                  </span>
                  <span className="font-semibold">{active.apprenticeName}</span>
                  <span className="text-ih-fg-4">submitted {active.submittedAt}</span>
                </div>
                <h2 className="text-lg font-bold tracking-tight text-ih-fg-1">{active.itemId}</h2>
                <p className="text-[12px] text-ih-fg-3 mt-1">Field: {active.field}</p>
              </header>

              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                <div className="bg-ih-bg-muted border border-ih-border rounded-md p-4">
                  <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-ih-fg-4 mb-2">Apprentice proposed</p>
                  <pre className="whitespace-pre-wrap text-sm text-ih-fg-2 leading-relaxed">
                    {active.proposedValue || "—"}
                  </pre>
                </div>

                {active.decision && (
                  <div className={`px-4 py-3 rounded-md text-sm border ${
                    active.decision === "approved"
                      ? "bg-ih-ok-bg border-ih-ok/30 text-ih-ok-fg"
                      : "bg-ih-bad-bg border-ih-bad/30 text-ih-bad-fg"
                  }`}>
                    Decision recorded: <span className="font-bold">{active.decision}</span>
                  </div>
                )}
              </div>

              {!active.decision && (
                <div className="border-t border-ih-border px-6 py-4 flex items-center gap-3">
                  <p className="text-[11px] text-ih-fg-3 flex-1 max-w-[300px]">
                    Approve to publish as-is. Reject sends back to the apprentice.
                  </p>
                  <button className="px-3 py-2 rounded-md text-[12px] font-bold border border-ih-bad/30 text-ih-bad-fg hover:bg-ih-bad-bg transition-colors">
                    Reject
                  </button>
                  <button className="px-4 py-2 rounded-md text-[12px] font-bold bg-ih-ok hover:bg-ih-ok/85 text-white transition-colors inline-flex items-center gap-1.5">
                    <CheckSmallIcon /> Approve
                  </button>
                </div>
              )}
            </section>
          ) : (
            <div className="flex items-center justify-center bg-ih-bg-card border border-ih-border rounded-md">
              <p className="text-[13px] text-ih-fg-3">Select an item from the queue.</p>
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
