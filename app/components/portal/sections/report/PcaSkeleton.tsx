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

function Block({
  id,
  title,
  children,
}: {
  /** Commercial PCA Phase O — registry section id, stamped on the wrapper so
   *  the TOC / PDF bookmarks anchor here. Omitted for blocks that aren't
   *  registry entries in their own right. */
  id?: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mb-5 print:break-inside-avoid scroll-mt-4">
      <h3 className="mb-1 text-sm font-semibold text-ih-fg-2">{title}</h3>
      <div className="whitespace-pre-line text-sm text-ih-fg-1">{children}</div>
    </section>
  );
}

/**
 * Commercial PCA Phase O — a bare chapter-divider heading for the level-1
 * system chapters (property-description, site, structural-envelope, mep,
 * interior, life-safety) that the registry lists but the skeleton doesn't yet
 * render detailed content for (the per-item findings render further down in
 * <ReportView>'s `filteredSections`, keyed by the inspection template's own
 * section ids — NOT the PCA registry ids). This gives every registry entry a
 * real anchor target (no dangling TOC links) and shows the full ASTM chapter
 * structure; a future phase can replace it with real chapter content.
 */
function ChapterDivider({ id, title }: { id: string; title: string }) {
  return (
    <h2
      id={id}
      className="mb-3 mt-6 text-sm font-semibold uppercase tracking-wide text-ih-fg-3 scroll-mt-4"
    >
      {title}
    </h2>
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
  tier,
  reportTimeZone = "UTC",
}: {
  data: PcaReportData | null;
  compliance?: PcaComplianceProps;
  /** Commercial PCA Phase T — report tier. `light_commercial` omits the
   *  full-tier-only Transmittal Letter + Systems Summary front matter (the TOC
   *  and the docx builder drop them too); null/full_pca render them. */
  tier?: "light_commercial" | "full_pca" | null;
  /** Tenant timezone (IANA) anchoring signoff dates. Defaults to UTC. */
  reportTimeZone?: string;
}) {
  if (!data) return null;
  const { narrative, deviations } = data;
  // Mirror the docx builder's `isLight` gate so the HTML body agrees with the
  // tier-gated TOC and the Word export.
  const isLight = tier === "light_commercial";
  const conformance = compliance?.conformance ?? null;
  const signoffs = compliance?.signoffs ?? [];
  const psq = compliance?.psq ?? null;
  const documentReview = compliance?.documentReview ?? [];
  const relianceText = compliance?.relianceText ?? null;
  return (
    <div className="mb-8">
      {/* Transmittal Letter + dual-role signature block — full tier only.
          light_commercial drops them (matches the tier-gated TOC + docx). */}
      {!isLight && (
        <>
          <Block id="transmittal-letter" title="Transmittal Letter">{narrative.transmittalLetter}</Block>
          {/* Transmittal signature slot — Phase M dual-role signoffs. */}
          <SignoffBlock signoffs={signoffs} timeZone={reportTimeZone} />

          {/* Wrapper carries the anchor unconditionally — SystemsSummaryTable
              itself renders null when there are no systems, which would otherwise
              leave a dangling #systems-summary TOC link on a full-tier report
              with an empty rollup. */}
          <div id="systems-summary" className="scroll-mt-4">
            <SystemsSummaryTable rows={data.systemsSummary} />
          </div>
        </>
      )}

      {/* 1. SUMMARY */}
      <h2 id="summary" className="mb-3 mt-6 text-sm font-semibold uppercase tracking-wide text-ih-fg-3 scroll-mt-4">1. Summary</h2>
      <Block id="summary.general-description" title="1.1 General Description">{narrative.summaryGeneralDescription}</Block>
      <Block id="summary.physical-condition" title="1.2 General Physical Condition">{narrative.summaryPhysicalCondition}</Block>
      {/* 1.3 Opinion of Cost — prose + EMPTY cost region (Phase C fills numbers). */}
      <section id="summary.opinion-of-cost" className="mb-5 print:break-inside-avoid scroll-mt-4">
        <h3 className="mb-1 text-sm font-semibold text-ih-fg-2">1.3 Opinion of Cost</h3>
        <div data-pca-cost-region className="text-sm text-ih-fg-3" aria-hidden="true" />
      </section>
      {/* 1.4 Deviations from the Guide — structured, with the ASTM conformance
          statement (Phase M) rendered adjacent. */}
      <section id="summary.deviations" className="mb-5 print:break-inside-avoid scroll-mt-4">
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
      <Block id="summary.recommendations" title="1.5 Recommendations">{narrative.summaryRecommendations}</Block>

      {/* 2. INTRODUCTION */}
      <h2 id="introduction" className="mb-3 mt-6 text-sm font-semibold uppercase tracking-wide text-ih-fg-3 scroll-mt-4">2. Introduction</h2>
      <Block id="introduction.purpose" title="2.1 Purpose">{narrative.purpose}</Block>
      <Block id="introduction.scope-of-work" title="2.2 Scope of Work">{narrative.scopeOfWork}</Block>
      <Block id="introduction.limitations-exceptions" title="2.3 Limitations & Exceptions">{narrative.limitationsExceptions}</Block>
      <Block id="introduction.reconnaissance" title="2.4 General Property Reconnaissance">{narrative.reconnaissance}</Block>
      {/* 2.5 User Reliance + §11.4.4 arm's-length disclosure slot (Phase M copy). */}
      <section id="introduction.user-reliance" className="mb-5 print:break-inside-avoid scroll-mt-4">
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

      {/* 3. GENERAL PROPERTY DESCRIPTION — chapter divider (Phase O); detailed
          content lives in the Building Profile block above the fold. */}
      <ChapterDivider id="property-description" title="General Property Description" />

      {/* Document Review & Interviews. */}
      <Block id="document-review" title="Document Review & Interviews">
        <DocumentReviewTable items={documentReview} />
        <PsqExhibit psq={psq} />
      </Block>

      {/* System chapters — dividers only (Phase O). The per-item findings for
          these systems render in <ReportView>'s `filteredSections`, keyed by
          the inspection template's own section ids, which don't line up with
          these canonical ASTM chapter ids 1:1. These headings exist so every
          registry entry has a real anchor and the report shows the full
          chapter structure; a later phase can bind real content to them. */}
      <ChapterDivider id="site" title="Site" />
      <ChapterDivider id="structural-envelope" title="Structural Frame & Building Envelope" />
      <ChapterDivider id="mep" title="Mechanical, Electrical & Plumbing" />
      <ChapterDivider id="interior" title="Interior Elements" />
      <ChapterDivider id="life-safety" title="Life Safety / Fire Protection" />

      <Block id="additional-considerations" title="Additional Considerations">{narrative.additionalConsiderations}</Block>
    </div>
  );
}
