/**
 * <ReportSummaryStats> — the at-a-glance card row at the top of the report.
 *
 * The cards are derived from THIS inspection's own rating system
 * (Spectora-style), not from fixed Satisfactory/Monitor/Defects buckets: items
 * are tallied by their rating level and one card is rendered per level that
 * actually occurs, using that level's own label and colour, ordered good→bad by
 * severity bucket and then by first appearance. The derivation lives with the
 * render because the ordering rule is only meaningful as the reading order of
 * these cards.
 *
 * Commercial PCA Phase O — this block is the report's "PCA Summary"
 * front-matter page (registry id `pca-summary`), so it carries that anchor for
 * the TOC / PDF bookmarks. It renders unconditionally, so the anchor is never
 * dangling regardless of tier.
 *
 * lint:ds — only `ih-*` design tokens; raw Tailwind colors are forbidden.
 */
import { m } from "~/paraglide/messages";
import { PRINT_CARD_CLASS, type ReportSection } from "./types";

const BUCKET_RANK: Record<string, number> = { satisfactory: 0, monitor: 1, defect: 2, other: 3 };

export function ReportSummaryStats({ sections, total }: { sections: ReportSection[]; total: number }) {
  const ratingTally = new Map<string, { label: string; color: string; bucket: string; count: number; seen: number }>();
  let seenOrder = 0;
  for (const it of sections.flatMap((s) => s.items)) {
    if (!it.rating) continue;
    const ex = ratingTally.get(it.rating);
    if (ex) ex.count++;
    else ratingTally.set(it.rating, { label: it.ratingLabel ?? it.rating, color: it.ratingColor, bucket: it.severityBucket, count: 1, seen: seenOrder++ });
  }
  const summaryCards: Array<{ label: string; value: number; color: string | null }> = [
    { label: m.report_view_stat_total(), value: total, color: null },
    ...[...ratingTally.values()]
      .sort((a, b) => (BUCKET_RANK[a.bucket] ?? 9) - (BUCKET_RANK[b.bucket] ?? 9) || a.seen - b.seen)
      .map((l) => ({ label: l.label, value: l.count, color: l.color })),
  ];

  return (
    <div id="pca-summary" className="max-w-4xl mx-auto px-4 sm:px-6 mb-6 scroll-mt-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {summaryCards.map((s) => (
          <div key={s.label} className={`bg-ih-bg-card border border-ih-border rounded-lg p-4 text-center ${PRINT_CARD_CLASS}`}>
            <div className={`text-2xl font-bold ${s.color ? "" : "text-ih-fg-1"}`} style={s.color ? { color: s.color } : undefined}>{s.value}</div>
            <div className="text-[11px] text-ih-fg-4 uppercase tracking-widest mt-1">
              {s.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
