import { useState } from "react";
import { useLoaderData } from "react-router";
import type { Route } from "./+types/repair-request";
import { apiFetch } from "~/lib/api.server";

export function meta() {
  return [{ title: "Repair Request - OpenInspection" }];
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface DefectEntry {
  sectionId: string;
  sectionTitle: string;
  itemId: string;
  itemLabel: string;
  comment: string;
  location: string | null;
  category: "safety" | "recommendation" | "maintenance";
  recommendationLabel: string | null;
  estimateLow: number | null;
  estimateHigh: number | null;
  photos: Array<{ key: string; url: string }>;
}

interface RepairRequestData {
  inspectionId: string;
  propertyAddress: string;
  inspectionDate: string | null;
  inspectorName: string | null;
  clientEmail: string | null;
  defects: DefectEntry[];
  showEstimates: boolean;
}

/* ------------------------------------------------------------------ */
/*  Loader                                                             */
/* ------------------------------------------------------------------ */

export async function loader({ params }: Route.LoaderArgs) {
  try {
    const res = await apiFetch(`/api/public/repair-request/${params.id}`);
    const json = res.ok ? ((await res.json()) as Record<string, unknown>) : {};
    return {
      data: (json.data as RepairRequestData) ?? null,
      error: res.ok ? null : "Not found",
    };
  } catch {
    return { data: null, error: "Service unavailable" };
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const CATEGORY_TONE: Record<
  DefectEntry["category"],
  { bg: string; text: string; ring: string; label: string }
> = {
  safety: {
    bg: "bg-rose-50 dark:bg-rose-900/20",
    text: "text-rose-700 dark:text-rose-300",
    ring: "ring-rose-200 dark:ring-rose-800",
    label: "Safety",
  },
  recommendation: {
    bg: "bg-amber-50 dark:bg-amber-900/20",
    text: "text-amber-700 dark:text-amber-300",
    ring: "ring-amber-200 dark:ring-amber-800",
    label: "Recommend",
  },
  maintenance: {
    bg: "bg-slate-50 dark:bg-slate-700/50",
    text: "text-slate-700 dark:text-slate-300",
    ring: "ring-slate-200 dark:ring-slate-600",
    label: "Maintain",
  },
};

function formatMoney(cents: number | null): string {
  if (cents == null || cents <= 0) return "";
  return "$" + Math.round(cents / 100).toLocaleString();
}

function groupBySection(
  entries: DefectEntry[],
): Array<{ sectionId: string; sectionTitle: string; items: DefectEntry[] }> {
  const order: string[] = [];
  const map = new Map<
    string,
    { sectionId: string; sectionTitle: string; items: DefectEntry[] }
  >();
  for (const e of entries) {
    if (!map.has(e.sectionId)) {
      map.set(e.sectionId, {
        sectionId: e.sectionId,
        sectionTitle: e.sectionTitle,
        items: [],
      });
      order.push(e.sectionId);
    }
    map.get(e.sectionId)!.items.push(e);
  }
  return order.map((id) => map.get(id)!);
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function CustomerRepairRequestPage() {
  const { data, error } = useLoaderData<typeof loader>();
  const [email, setEmail] = useState(data?.clientEmail ?? "");
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null);
  const [itemNotes, setItemNotes] = useState<Record<string, string>>({});

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <p className="text-slate-500">Repair request not found.</p>
      </div>
    );
  }

  const grouped = groupBySection(data.defects);

  async function sendEmail() {
    if (!email || sending) return;
    setSending(true);
    setToast(null);
    try {
      const res = await fetch("/api/public/repair-request/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inspectionId: data.inspectionId,
          recipientEmail: email,
          itemNotes,
        }),
      });
      if (res.ok) {
        setToast({ text: "Email sent!", error: false });
      } else {
        setToast({ text: "Failed to send email", error: true });
      }
    } catch {
      setToast({ text: "Network error", error: true });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <header className="mb-6">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-1">
          Repair Request
        </p>
        <h1 className="text-[24px] sm:text-[28px] font-semibold tracking-tight text-slate-900 dark:text-slate-100 leading-tight">
          {data.propertyAddress}
        </h1>
        <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-2">
          Generated from your inspection report. Review the items below, add any
          comments for your contractor, then print this list or email a copy to yourself.
        </p>
        {(data.inspectionDate || data.inspectorName) && (
          <p className="text-[12px] text-slate-500 dark:text-slate-400 mt-1">
            {data.inspectionDate && (
              <span>
                Inspected{" "}
                <strong className="text-slate-700 dark:text-slate-300">
                  {data.inspectionDate}
                </strong>
              </span>
            )}
            {data.inspectorName && (
              <span>
                {" "}
                &middot; By{" "}
                <strong className="text-slate-700 dark:text-slate-300">
                  {data.inspectorName}
                </strong>
              </span>
            )}
          </p>
        )}
      </header>

      {/* Toolbar */}
      <div className="print:hidden mb-6 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 px-3 h-9 rounded-md bg-slate-900 text-white text-[12px] font-bold hover:bg-slate-700 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"
            />
          </svg>
          Download PDF
        </button>
        <div className="flex items-center gap-2 flex-1 min-w-[260px]">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="flex-1 h-9 px-3 rounded-md border border-slate-200 dark:border-slate-600 text-[13px] text-slate-900 dark:text-slate-100 placeholder-slate-400 bg-white dark:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-300"
          />
          <button
            type="button"
            onClick={sendEmail}
            disabled={sending || !email}
            className="inline-flex items-center gap-1.5 px-3 h-9 rounded-md bg-blue-600 text-white text-[12px] font-bold hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
          >
            {sending ? "Sending..." : "Email this list to me"}
          </button>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`print:hidden mb-4 px-4 py-2 rounded-md text-[13px] font-semibold ${
            toast.error
              ? "bg-rose-50 dark:bg-rose-900/20 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800"
              : "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
          }`}
        >
          {toast.text}
        </div>
      )}

      {/* Empty state */}
      {data.defects.length === 0 && (
        <div className="text-center py-12 px-6 rounded-md bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
          <p className="text-[14px] text-emerald-700 dark:text-emerald-300 font-semibold">
            Good news! No defects were flagged on your inspection.
          </p>
          <p className="text-[12px] text-emerald-600 dark:text-emerald-400 mt-1">
            There is nothing to request a repair for.
          </p>
        </div>
      )}

      {/* Defects grouped by section */}
      {grouped.map((group) => (
        <section key={group.sectionId} className="space-y-3 mb-8">
          <header className="flex items-baseline justify-between border-b border-slate-200 dark:border-slate-700 pb-2">
            <h2 className="text-[14px] font-bold text-slate-900 dark:text-slate-100">
              {group.sectionTitle}
            </h2>
            <span className="text-[11px] text-slate-400 dark:text-slate-500 font-mono">
              {group.items.length} item{group.items.length === 1 ? "" : "s"}
            </span>
          </header>
          <ul className="space-y-3">
            {group.items.map((d, idx) => {
              const tone = CATEGORY_TONE[d.category];
              const lo = formatMoney(d.estimateLow);
              const hi = formatMoney(d.estimateHigh);
              const showEstimateBadge = data.showEstimates && (lo || hi);
              return (
                <li
                  key={d.itemId}
                  className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-5 py-4"
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide ring-1 ring-inset ${tone.bg} ${tone.text} ${tone.ring}`}
                        >
                          {tone.label}
                        </span>
                        <span className="text-[11px] font-mono text-slate-400 dark:text-slate-500">
                          {group.sectionTitle} &rsaquo; {d.itemLabel}
                        </span>
                      </div>
                      <p className="text-[14px] font-semibold text-slate-900 dark:text-slate-100 leading-snug">
                        {d.itemLabel}
                      </p>
                      {d.location && (
                        <p className="text-[12px] text-slate-500 dark:text-slate-400 mt-0.5">
                          Location: {d.location}
                        </p>
                      )}
                    </div>
                    {d.recommendationLabel && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 ring-1 ring-inset ring-blue-200 dark:ring-blue-800">
                        {d.recommendationLabel}
                      </span>
                    )}
                  </div>

                  {d.comment && (
                    <p className="text-[13px] text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-line">
                      {d.comment}
                    </p>
                  )}

                  {showEstimateBadge && (
                    <div className="mt-3 inline-flex items-center px-2 py-1 rounded-md text-[12px] font-semibold bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 tabular-nums">
                      Estimated cost: {lo || "$?"} - {hi || "$?"}
                    </div>
                  )}

                  {d.photos.length > 0 && (
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      {d.photos.slice(0, 6).map((p, pi) => (
                        <img
                          key={p.key}
                          src={p.url}
                          alt={`${d.itemLabel} photo ${pi + 1}`}
                          className="w-full h-24 object-cover rounded border border-slate-200 dark:border-slate-700"
                          loading="lazy"
                        />
                      ))}
                    </div>
                  )}

                  {/* Customer comments */}
                  <div className="mt-3">
                    <label
                      htmlFor={`crr-note-${d.itemId}-${idx}`}
                      className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-1"
                    >
                      Your notes for the contractor
                    </label>
                    <textarea
                      id={`crr-note-${d.itemId}-${idx}`}
                      rows={2}
                      className="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-600 text-[13px] text-slate-900 dark:text-slate-100 placeholder-slate-400 bg-slate-50 dark:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-300"
                      placeholder="Optional comment (e.g. preferred quote scope, timing, access details)"
                      onChange={(e) =>
                        setItemNotes((prev) => ({
                          ...prev,
                          [d.itemId]: e.target.value,
                        }))
                      }
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <footer className="print:hidden mt-12 pt-6 border-t border-slate-200 dark:border-slate-700 text-[11px] text-slate-400 dark:text-slate-500 text-center">
        Generated by <strong className="text-slate-600 dark:text-slate-400">OpenInspection</strong>.
        This list reflects items flagged in your inspection report and does not constitute a
        legally binding contract or repair scope.
      </footer>
    </div>
  );
}
