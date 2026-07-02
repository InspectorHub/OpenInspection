import type { PcaReportData } from "./types";
import { SystemsSummaryTable } from "./SystemsSummaryTable";

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5 print:break-inside-avoid">
      <h3 className="mb-1 text-sm font-semibold text-ih-fg-2">{title}</h3>
      <div className="whitespace-pre-line text-sm text-ih-fg-1">{children}</div>
    </section>
  );
}

/**
 * Commercial PCA Phase S report skeleton. Renders the ASTM §11 / real-PCA
 * front matter + Summary + Introduction structure above the system-chapter
 * body. Section names come from data.sectionRegistry (the single registry).
 * The §1.3 cost region is left EMPTY for Phase C; the §11.4.4 arm's-length
 * disclosure has a dedicated render slot in §2 (copy filled by Phase M).
 */
export function PcaSkeleton({ data }: { data: PcaReportData | null }) {
  if (!data) return null;
  const { narrative, deviations } = data;
  return (
    <div className="mb-8">
      {/* Transmittal Letter (full tier; gated upstream) */}
      <Block title="Transmittal Letter">{narrative.transmittalLetter}</Block>

      <SystemsSummaryTable rows={data.systemsSummary} />

      {/* 1. SUMMARY */}
      <h2 className="mb-3 mt-6 text-sm font-semibold uppercase tracking-wide text-ih-fg-3">1. Summary</h2>
      <Block title="1.1 General Description">{narrative.summaryGeneralDescription}</Block>
      <Block title="1.2 General Physical Condition">{narrative.summaryPhysicalCondition}</Block>
      {/* 1.3 Opinion of Cost — prose + EMPTY cost region (Phase C fills numbers). */}
      <section className="mb-5 print:break-inside-avoid">
        <h3 className="mb-1 text-sm font-semibold text-ih-fg-2">1.3 Opinion of Cost</h3>
        <div data-pca-cost-region className="text-sm text-ih-fg-3" aria-hidden="true" />
      </section>
      {/* 1.4 Deviations from the Guide — structured. */}
      <section className="mb-5 print:break-inside-avoid">
        <h3 className="mb-1 text-sm font-semibold text-ih-fg-2">1.4 Deviations from the Guide</h3>
        {deviations.length === 0 ? (
          <p className="text-sm text-ih-fg-3">No deviations from the Guide.</p>
        ) : (
          <ul className="space-y-2 text-sm text-ih-fg-1">
            {deviations.map((d) => (
              <li key={d.id} className="border-l-2 border-ih-border pl-3">
                <span className="font-medium">{d.area}:</span> {d.deviation}
                <span className="block text-ih-fg-3">Baseline: {d.baselineRequirement} — Reason: {d.reason}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <Block title="1.5 Recommendations">{narrative.summaryRecommendations}</Block>

      {/* 2. INTRODUCTION */}
      <h2 className="mb-3 mt-6 text-sm font-semibold uppercase tracking-wide text-ih-fg-3">2. Introduction</h2>
      <Block title="2.1 Purpose">{narrative.purpose}</Block>
      <Block title="2.2 Scope of Work">{narrative.scopeOfWork}</Block>
      <Block title="2.3 Limitations & Exceptions">{narrative.limitationsExceptions}</Block>
      <Block title="2.4 General Property Reconnaissance">{narrative.reconnaissance}</Block>
      {/* 2.5 User Reliance + §11.4.4 arm's-length disclosure slot (copy filled by Phase M). */}
      <section className="mb-5 print:break-inside-avoid">
        <h3 className="mb-1 text-sm font-semibold text-ih-fg-2">2.5 User Reliance</h3>
        <p data-pca-reliance className="text-sm text-ih-fg-3">
          The consultant&rsquo;s relationship to the client is disclosed in accordance with ASTM E2018 §7.3.
        </p>
      </section>

      {/* Document Review & Interviews + Additional Considerations. */}
      <Block title="Document Review & Interviews">{/* PSQ + doc-review content — Phase M */}{" "}</Block>
      <Block title="Additional Considerations">{narrative.additionalConsiderations}</Block>
    </div>
  );
}
