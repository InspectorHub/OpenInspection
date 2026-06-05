import { useState } from "react";
import { useLoaderData } from "react-router";
import type { Route } from "./+types/repair-request";
import { createApi } from "~/lib/api-client.server";

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

export async function loader({ params, context }: Route.LoaderArgs) {
  try {
    const api = createApi(context);
    const res = await api.repairRequests["repair-request"][":id"].$get({
      param: { id: params.id ?? "" },
    });
    const body = res.ok ? await res.json() : {};
    const d = ((body as Record<string, unknown>).data ?? {}) as Record<string, unknown>;
    return {
      data: (Object.keys(d).length > 0 ? d : null) as RepairRequestData | null,
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
    bg: "bg-ih-bad-bg",
    text: "text-ih-bad-fg",
    ring: "ring-ih-bad/30",
    label: "Safety",
  },
  recommendation: {
    bg: "bg-ih-watch-bg",
    text: "text-ih-watch-fg",
    ring: "ring-ih-watch/30",
    label: "Recommend",
  },
  maintenance: {
    bg: "bg-ih-bg-muted",
    text: "text-ih-fg-3",
    ring: "ring-ih-border",
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
        <p className="text-ih-fg-3">Repair request not found.</p>
      </div>
    );
  }

  const grouped = groupBySection(data.defects);

  async function sendEmail() {
    if (!email || sending || !data) return;
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
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-4 mb-1">
          Repair Request
        </p>
        <h1 className="text-[24px] sm:text-[28px] font-semibold tracking-tight text-ih-fg-1 leading-tight">
          {data.propertyAddress}
        </h1>
        <p className="text-[13px] text-ih-fg-3 mt-2">
          Generated from your inspection report. Review the items below, add any
          comments for your contractor, then print this list or email a copy to yourself.
        </p>
        {(data.inspectionDate || data.inspectorName) && (
          <p className="text-[12px] text-ih-fg-3 mt-1">
            {data.inspectionDate && (
              <span>
                Inspected{" "}
                <strong className="text-ih-fg-3">
                  {data.inspectionDate}
                </strong>
              </span>
            )}
            {data.inspectorName && (
              <span>
                {" "}
                &middot; By{" "}
                <strong className="text-ih-fg-3">
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
          className="inline-flex items-center gap-1.5 px-3 h-9 rounded-md bg-ih-bg-inverse text-ih-fg-inverse text-[12px] font-bold hover:bg-ih-bg-inverse/90 transition-colors"
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
            className="flex-1 h-9 px-3 rounded-md border border-ih-border text-[13px] text-ih-fg-1 placeholder:text-ih-fg-4 bg-ih-bg-card focus:outline-none focus:ring-2 focus:ring-ih-border-strong"
          />
          <button
            type="button"
            onClick={sendEmail}
            disabled={sending || !email}
            className="inline-flex items-center gap-1.5 px-3 h-9 rounded-md bg-ih-info text-white text-[12px] font-bold hover:bg-ih-info/85 disabled:bg-ih-bg-muted disabled:cursor-not-allowed transition-colors"
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
              ? "bg-ih-bad-bg text-ih-bad-fg border border-ih-bad"
              : "bg-ih-ok-bg text-ih-ok-fg border border-ih-ok"
          }`}
        >
          {toast.text}
        </div>
      )}

      {/* Empty state */}
      {data.defects.length === 0 && (
        <div className="text-center py-12 px-6 rounded-md bg-ih-ok-bg border border-ih-ok">
          <p className="text-[14px] text-ih-ok-fg font-semibold">
            Good news! No defects were flagged on your inspection.
          </p>
          <p className="text-[12px] text-ih-ok-fg mt-1">
            There is nothing to request a repair for.
          </p>
        </div>
      )}

      {/* Defects grouped by section */}
      {grouped.map((group) => (
        <section key={group.sectionId} className="space-y-3 mb-8">
          <header className="flex items-baseline justify-between border-b border-ih-border pb-2">
            <h2 className="text-[14px] font-bold text-ih-fg-1">
              {group.sectionTitle}
            </h2>
            <span className="text-[11px] text-ih-fg-4 font-mono">
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
                  className="rounded-md border border-ih-border bg-ih-bg-card px-5 py-4"
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide ring-1 ring-inset ${tone.bg} ${tone.text} ${tone.ring}`}
                        >
                          {tone.label}
                        </span>
                        <span className="text-[11px] font-mono text-ih-fg-4">
                          {group.sectionTitle} &rsaquo; {d.itemLabel}
                        </span>
                      </div>
                      <p className="text-[14px] font-semibold text-ih-fg-1 leading-snug">
                        {d.itemLabel}
                      </p>
                      {d.location && (
                        <p className="text-[12px] text-ih-fg-3 mt-0.5">
                          Location: {d.location}
                        </p>
                      )}
                    </div>
                    {d.recommendationLabel && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide bg-ih-info-bg text-ih-info-fg ring-1 ring-inset ring-ih-info/30">
                        {d.recommendationLabel}
                      </span>
                    )}
                  </div>

                  {d.comment && (
                    <p className="text-[13px] text-ih-fg-3 leading-relaxed whitespace-pre-line">
                      {d.comment}
                    </p>
                  )}

                  {showEstimateBadge && (
                    <div className="mt-3 inline-flex items-center px-2 py-1 rounded-md text-[12px] font-semibold bg-ih-ok-bg text-ih-ok-fg tabular-nums">
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
                          className="w-full h-24 object-cover rounded border border-ih-border"
                          loading="lazy"
                        />
                      ))}
                    </div>
                  )}

                  {/* Customer comments */}
                  <div className="mt-3">
                    <label
                      htmlFor={`crr-note-${d.itemId}-${idx}`}
                      className="block text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-4 mb-1"
                    >
                      Your notes for the contractor
                    </label>
                    <textarea
                      id={`crr-note-${d.itemId}-${idx}`}
                      rows={2}
                      className="w-full px-3 py-2 rounded-md border border-ih-border text-[13px] text-ih-fg-1 placeholder:text-ih-fg-4 bg-ih-bg-muted focus:outline-none focus:ring-2 focus:ring-ih-border-strong"
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

      <footer className="print:hidden mt-12 pt-6 border-t border-ih-border text-[11px] text-ih-fg-4 text-center">
        Generated by <strong className="text-ih-fg-3">OpenInspection</strong>.
        This list reflects items flagged in your inspection report and does not constitute a
        legally binding contract or repair scope.
      </footer>
    </div>
  );
}
