/**
 * Which HALF of a translated report a component is rendering inside.
 *
 * A context rather than a prop chain, because the two facts below are needed by
 * components several levels apart — the table of contents, a section block, the
 * PCA front matter, the photo appendix — and threading them through every
 * intermediate would put a translation concern into the signature of components
 * that have nothing to do with translation.
 *
 * ## Why anchors need a namespace at all
 *
 * The PRINTED deliverable renders both halves in one document. HTML ids are
 * global to that document, so a second copy of the report brings a second copy
 * of every anchor the table of contents links to — and a duplicate id does not
 * error, it silently resolves to the FIRST one. The translated half's contents
 * page would then link back into the English pages, and the two-pass page-number
 * mechanism (`server/lib/toc-pages.ts` reads the named destinations Chrome emits
 * for each `<a href="#id">`) would resolve every entry to an English page. The
 * file would look right and send its Spanish reader to the wrong page, which is
 * exactly the "two documents stapled together" reading the one-file shape exists
 * to prevent.
 *
 * So the translated half prefixes every anchor it emits. Nothing else changes:
 * the prefix is `""` everywhere else, including on the web where only one half
 * is ever in the DOM, so every existing anchor, TOC link and stored page map
 * keeps the id it always had.
 *
 * ## `showingTranslation` is NOT the same question as the prefix
 *
 * On the web a reader toggles to the translation and there is still only one
 * half in the document — translated content, unprefixed anchors. In print there
 * are two. Keeping the two flags separate is what lets both be true.
 */
import { createContext, useContext, useMemo } from "react";

export interface ReportHalfScopeValue {
  /** Prepended to every document anchor id emitted inside this half. */
  anchorPrefix: string;
  /** True when the content in this half is the courtesy translation. */
  showingTranslation: boolean;
}

/**
 * The default is the ONLY half: no prefix, no translation. Every component
 * below reads it without a provider and behaves exactly as it did before this
 * module existed — which is what keeps the change invisible to the web report,
 * to the standalone route and to every existing test.
 */
const DEFAULT: ReportHalfScopeValue = { anchorPrefix: "", showingTranslation: false };

const ReportHalfScopeContext = createContext<ReportHalfScopeValue>(DEFAULT);

export function ReportHalfScope({
  anchorPrefix,
  showingTranslation,
  children,
}: ReportHalfScopeValue & { children: React.ReactNode }) {
  const value = useMemo(
    () => ({ anchorPrefix, showingTranslation }),
    [anchorPrefix, showingTranslation],
  );
  return (
    <ReportHalfScopeContext.Provider value={value}>{children}</ReportHalfScopeContext.Provider>
  );
}

/**
 * The id to put on an anchor, and the id to link to.
 *
 * Both sides of an intra-document link MUST go through this. A link built from
 * the raw id inside a prefixed half points at the other half's copy, which is
 * the precise failure this exists to stop and one that no test of a single half
 * can see.
 */
export function useAnchorId(): (id: string) => string {
  const { anchorPrefix } = useContext(ReportHalfScopeContext);
  return useMemo(() => (id: string) => `${anchorPrefix}${id}`, [anchorPrefix]);
}

/** True when the surrounding half is showing the courtesy translation. */
export function useShowingTranslation(): boolean {
  return useContext(ReportHalfScopeContext).showingTranslation;
}
