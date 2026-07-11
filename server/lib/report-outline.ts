/**
 * Report Table-of-Contents projection (Commercial PCA Phase O).
 *
 * Phase S owns the ordered, tier-gated section registry
 * (`server/lib/pca-section-registry.ts`); Phase O projects it into
 * `ReportOutlineEntry[]` for the TOC, on-page anchors, PDF bookmarks, and
 * (Phase W) the Word TOC field. This module is a PURE projection — it neither
 * orders nor tier-gates (Phase S's `gatedSectionRegistry` already did both);
 * it only copies the fields the TOC needs, drops the two front-matter entries
 * a TOC should never list itself (`cover`, `toc`), and leaves `page` for the
 * render layers to fill.
 */
import type { PcaSectionEntry } from './pca-section-registry';

/** Ids that are self-referential for a table of contents: the cover page and
 *  the TOC entry itself never appear as TOC rows. */
const SELF_REFERENTIAL_IDS = new Set(['cover', 'toc']);

export interface ReportOutlineEntry {
  id: string;
  /** Heading depth, mirrors `PcaSectionEntry.level` (0 = front-matter, 1 = chapter, 2 = subsection). */
  level: number;
  title: string;
  /** Filled by the PDF measurement pass; undefined/null on the web (meaningless for a scrolling doc). */
  page?: number | null;
}

export function buildReportOutline(sections: PcaSectionEntry[]): ReportOutlineEntry[] {
  return sections
    .filter((s) => s.id.trim() !== '' && s.title.trim() !== '' && !SELF_REFERENTIAL_IDS.has(s.id))
    .map((s) => ({ id: s.id, level: s.level, title: s.title }));
}
