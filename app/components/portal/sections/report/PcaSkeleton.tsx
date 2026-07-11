import type {
  PcaReportData,
  AstmConformance,
  ReportSignoffView,
  PsqView,
  DocReviewView,
  RelianceText,
} from "./types";
import { SystemsSummaryTable } from "./SystemsSummaryTable";
import { ConformanceStatement } from "./ConformanceStatement";
import { SignoffBlock } from "./SignoffBlock";
import { DocumentReviewTable } from "./DocumentReviewTable";
import { PsqExhibit } from "./PsqExhibit";

/** Commercial PCA Phase M — the compliance-record surfaces rendered into the
 *  Phase S slots below. Optional (partial-payload transition safety); every
 *  field is null/empty-safe in the loader, so this only ever adds content —
 *  it never blocks the skeleton from rendering. */
export interface PcaComplianceProps {
  conformance: AstmConformance | null;
  signoffs: ReportSignoffView[];
  psq: PsqView | null;
  documentReview: DocReviewView[];
  relianceText: RelianceText;
}

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
export function PcaSkeleton({
  data,
  compliance,
}: {
  data: PcaReportData | null;
  compliance?: PcaComplianceProps;
}) {
  if (!data) return null;
  const { narrative, deviations } = data;
  const conformance = compliance?.conformance ?? null;
  const signoffs = compliance?.signoffs ?? [];
  const psq = compliance?.psq ?? null;
  const documentReview = compliance?.documentReview ?? [];
  const relianceText = compliance?.relianceText ?? null;
  return (
    <div className="mb-8">
      {/* Transmittal Letter (full tier; gated upstream) */}
      <Block title="Transmittal Letter">{narrative.transmittalLetter}</Block>
      {/* Transmittal signature slot — Phase M dual-role signoffs. */}
      <SignoffBlock signoffs={signoffs} />

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
      {/* 1.4 Deviations from the Guide — structured, with the ASTM conformance
          statement (Phase M) rendered adjacent. */}
      <section className="mb-5 print:break-inside-avoid">
        <h3 className="mb-1 text-sm font-semibold text-ih-fg-2">1.4 Deviations from the Guide</h3>
        <ConformanceStatement conformance={conformance} />
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
      {/* 2.5 User Reliance + §11.4.4 arm's-length disclosure slot (Phase M copy). */}
      <section className="mb-5 print:break-inside-avoid">
        <h3 className="mb-1 text-sm font-semibold text-ih-fg-2">2.5 User Reliance</h3>
        <p data-pca-reliance className="text-sm text-ih-fg-3">
          {relianceText?.userReliance ||
            "The consultant’s relationship to the client is disclosed in accordance with ASTM E2018 §7.3."}
        </p>
        {relianceText?.pointInTime ? (
          <p className="text-sm text-ih-fg-3">{relianceText.pointInTime}</p>
        ) : null}
        {relianceText?.siteSpecific ? (
          <p className="text-sm text-ih-fg-3">{relianceText.siteSpecific}</p>
        ) : null}
      </section>

      {/* Document Review & Interviews + Additional Considerations. */}
      <Block title="Document Review & Interviews">
        <DocumentReviewTable items={documentReview} />
        <PsqExhibit psq={psq} />
      </Block>
      <Block title="Additional Considerations">{narrative.additionalConsiderations}</Block>
    </div>
  );
}
