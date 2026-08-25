import { m } from "~/paraglide/messages";
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
import { EnglishSpanBadge } from "./TranslationNotice";
import { useAnchorId, useShowingTranslation } from "./report-half-scope";

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
  const anchorId = useAnchorId();
  return (
    <section id={id ? anchorId(id) : undefined} className="mb-5 print:break-inside-avoid scroll-mt-4">
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
  const anchorId = useAnchorId();
  return (
    <h2
      id={anchorId(id)}
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
  // Every id below is a table-of-contents target, so all of them are namespaced
  // per half — see report-half-scope. `showingTranslation` is read from the
  // same place rather than taken as a prop: this whole block is classified
  // non-translatable, so what it needs to know is which half it is standing in,
  // not what a caller decided.
  const anchorId = useAnchorId();
  const showingTranslation = useShowingTranslation();
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
      {/* The WHOLE of this block is classified as part of the inspection record
          and is never machine-translated — the purpose, the scope of work and
          the limitations each bound what may be claimed against the report. So
          inside the translated half it is several PAGES of English, and the
          per-clause badge further down covers one paragraph of it. One sentence
          here says the rest is deliberate, which reading an actual printed
          render is what showed to be missing: a reader who decides the
          translation is broken discounts the notice along with it. */}
      {showingTranslation && (
        <p
          data-english-span-scope="pca-front-matter"
          className="mb-4 text-[12px] leading-relaxed text-ih-fg-3"
        >
          {m.courtesy_translation_english_block()}
          <EnglishSpanBadge showing />
        </p>
      )}
      {/* Transmittal Letter + dual-role signature block — full tier only.
          light_commercial drops them (matches the tier-gated TOC + docx). */}
      {!isLight && (
        <>
          <Block id="transmittal-letter" title={m.pca_skeleton_transmittal_letter()}>{narrative.transmittalLetter}</Block>
          {/* Transmittal signature slot — Phase M dual-role signoffs. */}
          <SignoffBlock signoffs={signoffs} timeZone={reportTimeZone} />

          {/* Wrapper carries the anchor unconditionally — SystemsSummaryTable
              itself renders null when there are no systems, which would otherwise
              leave a dangling #systems-summary TOC link on a full-tier report
              with an empty rollup. */}
          <div id={anchorId("systems-summary")} className="scroll-mt-4">
            <SystemsSummaryTable rows={data.systemsSummary} />
          </div>
        </>
      )}

      {/* 1. SUMMARY */}
      <h2 id={anchorId("summary")} className="mb-3 mt-6 text-sm font-semibold uppercase tracking-wide text-ih-fg-3 scroll-mt-4">{m.pca_skeleton_summary()}</h2>
      <Block id="summary.general-description" title={m.pca_skeleton_summary_general_description()}>{narrative.summaryGeneralDescription}</Block>
      <Block id="summary.physical-condition" title={m.pca_skeleton_summary_physical_condition()}>{narrative.summaryPhysicalCondition}</Block>
      {/* 1.3 Opinion of Cost — prose + EMPTY cost region (Phase C fills numbers). */}
      <section id={anchorId("summary.opinion-of-cost")} className="mb-5 print:break-inside-avoid scroll-mt-4">
        <h3 className="mb-1 text-sm font-semibold text-ih-fg-2">{m.pca_skeleton_summary_opinion_of_cost()}</h3>
        <div data-pca-cost-region className="text-sm text-ih-fg-3" aria-hidden="true" />
      </section>
      {/* 1.4 Deviations from the Guide — structured, with the ASTM conformance
          statement (Phase M) rendered adjacent. */}
      <section id={anchorId("summary.deviations")} className="mb-5 print:break-inside-avoid scroll-mt-4">
        <h3 className="mb-1 text-sm font-semibold text-ih-fg-2">{m.pca_skeleton_summary_deviations()}</h3>
        <ConformanceStatement conformance={conformance} />
        {deviations.length === 0 ? (
          <p className="text-sm text-ih-fg-3">{m.pca_skeleton_no_deviations()}</p>
        ) : (
          <ul className="space-y-2 text-sm text-ih-fg-1">
            {deviations.map((d) => (
              <li key={d.id} className="border-l-2 border-ih-border pl-3">
                <span className="font-medium">{d.area}:</span> {d.deviation}
                <span className="block text-ih-fg-3">{m.pca_skeleton_deviation_baseline_reason({ baseline: d.baselineRequirement, reason: d.reason })}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <Block id="summary.recommendations" title={m.pca_skeleton_summary_recommendations()}>{narrative.summaryRecommendations}</Block>

      {/* 2. INTRODUCTION */}
      <h2 id={anchorId("introduction")} className="mb-3 mt-6 text-sm font-semibold uppercase tracking-wide text-ih-fg-3 scroll-mt-4">{m.pca_skeleton_introduction()}</h2>
      <Block id="introduction.purpose" title={m.pca_skeleton_introduction_purpose()}>{narrative.purpose}</Block>
      <Block id="introduction.scope-of-work" title={m.pca_skeleton_introduction_scope_of_work()}>{narrative.scopeOfWork}</Block>
      <Block id="introduction.limitations-exceptions" title={m.pca_skeleton_introduction_limitations()}>{narrative.limitationsExceptions}</Block>
      <Block id="introduction.reconnaissance" title={m.pca_skeleton_introduction_reconnaissance()}>{narrative.reconnaissance}</Block>
      {/* 2.5 User Reliance + §11.4.4 arm's-length disclosure slot (Phase M copy). */}
      <section id={anchorId("introduction.user-reliance")} data-english-span-scope="reliance" className="mb-5 print:break-inside-avoid scroll-mt-4">
        {/* The clause that decides whether a third party may rely on this
            report. It is never machine-translated, so inside the translated
            half it is an English paragraph in the middle of other prose — and
            unmarked, a reader concludes the translation is broken and discounts
            the notice along with it. The badge says the English is deliberate. */}
        <h3 className="mb-1 text-sm font-semibold text-ih-fg-2">
          {m.pca_skeleton_introduction_user_reliance()}
          <EnglishSpanBadge showing={showingTranslation} />
        </h3>
        <p data-pca-reliance className="text-sm text-ih-fg-3">
          {relianceText?.userReliance || m.pca_skeleton_reliance_default()}
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
      <ChapterDivider id="property-description" title={m.pca_skeleton_chapter_property_description()} />

      {/* Document Review & Interviews. */}
      <Block id="document-review" title={m.pca_skeleton_document_review()}>
        <DocumentReviewTable items={documentReview} />
        <PsqExhibit psq={psq} />
      </Block>

      {/* System chapters — dividers only (Phase O). The per-item findings for
          these systems render in <ReportView>'s `filteredSections`, keyed by
          the inspection template's own section ids, which don't line up with
          these canonical ASTM chapter ids 1:1. These headings exist so every
          registry entry has a real anchor and the report shows the full
          chapter structure; a later phase can bind real content to them. */}
      <ChapterDivider id="site" title={m.pca_skeleton_chapter_site()} />
      <ChapterDivider id="structural-envelope" title={m.pca_skeleton_chapter_structural_envelope()} />
      <ChapterDivider id="mep" title={m.pca_skeleton_chapter_mep()} />
      <ChapterDivider id="interior" title={m.pca_skeleton_chapter_interior()} />
      <ChapterDivider id="life-safety" title={m.pca_skeleton_chapter_life_safety()} />

      <Block id="additional-considerations" title={m.pca_skeleton_additional_considerations()}>{narrative.additionalConsiderations}</Block>
    </div>
  );
}
