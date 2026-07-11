/** Minimal view of a resolved report photo (as produced by mapReportPhoto). */
interface ReportPhotoLike {
  key: string;
  originalKey?: string;
  url: string;
  caption?: string | null;
  media?: unknown;
}

interface ItemLike {
  id: string;
  label: string;
  photos: ReportPhotoLike[];
  resolvedTabs?: { defects?: Array<{ defectPhotos?: ReportPhotoLike[] }> };
}
interface SectionLike {
  id: string;
  title: string;
  items: ItemLike[];
}

/** A single entry in the centralized photo appendix (Appendix B). */
export interface AppendixPhoto {
  photoNo: number;
  key: string;
  url: string;
  caption: string | null;
  sectionId: string;
  sectionTitle: string;
  itemId: string;
  itemLabel: string;
}

/**
 * Commercial PCA Phase P — assign a continuous, stable, gap-free `photoNo`
 * to every report photo in document order and collect the flat photo
 * appendix. Order: section order → item order → an item's own photos before
 * its defect photos → array order. A physical photo (keyed by `key`) gets ONE
 * number even if it is referenced from more than one place. Render-assigned,
 * never stored: the same render inputs always yield the same numbering (it
 * feeds the PDF content hash, so it must be deterministic).
 *
 * Returns the section tree with each photo stamped (`photoNo` added in place on
 * a shallow copy) plus the flat `appendix` list the renderer emits as Appendix B.
 */
export function assignPhotoNumbers(sections: SectionLike[]): {
  sections: SectionLike[];
  appendix: AppendixPhoto[];
} {
  const appendix: AppendixPhoto[] = [];
  const numberByKey = new Map<string, number>();
  let next = 1;

  const stamp = (
    p: ReportPhotoLike,
    ctx: { sectionId: string; sectionTitle: string; itemId: string; itemLabel: string },
  ): ReportPhotoLike & { photoNo: number } => {
    let no = numberByKey.get(p.key);
    if (no === undefined) {
      no = next++;
      numberByKey.set(p.key, no);
      appendix.push({
        photoNo: no,
        key: p.key,
        url: p.url,
        caption: p.caption ?? null,
        ...ctx,
      });
    }
    return { ...p, photoNo: no };
  };

  const outSections = sections.map((sec) => ({
    ...sec,
    items: sec.items.map((item) => {
      const ctx = { sectionId: sec.id, sectionTitle: sec.title, itemId: item.id, itemLabel: item.label };
      const photos = (item.photos ?? []).map((p) => stamp(p, ctx));
      const defects = (item.resolvedTabs?.defects ?? []).map((d) => ({
        ...d,
        defectPhotos: (d.defectPhotos ?? []).map((p) => stamp(p, ctx)),
      }));
      return {
        ...item,
        photos,
        ...(item.resolvedTabs ? { resolvedTabs: { ...item.resolvedTabs, defects } } : {}),
      };
    }),
  }));

  return { sections: outSections, appendix };
}

/**
 * Commercial PCA Phase P — build a `photo_ref` → `photoNo` index over the
 * appendix. `photo_ref` is the photo storage `key`; the cost reserve table
 * (Phase C, the SECTION NO. / PHOTO NO. column) and observations resolve their
 * ref through this to print the appendix photo number / anchor.
 */
export function buildPhotoRefIndex(appendix: AppendixPhoto[]): Map<string, number> {
  const idx = new Map<string, number>();
  for (const p of appendix) idx.set(p.key, p.photoNo);
  return idx;
}

/**
 * Resolve a single `photo_ref` to its appendix `photoNo`. Returns null when the
 * ref is empty or points at a photo absent from the appendix (excluded/removed)
 * so the body renders no broken PHOTO NO. pointer.
 */
export function resolvePhotoRef(
  index: Map<string, number>,
  photoRef: string | null | undefined,
): number | null {
  if (!photoRef) return null;
  return index.get(photoRef) ?? null;
}

export type PhotoMode = 'appendix' | 'inline';

/**
 * Commercial PCA Phase P — derive the report's photo presentation mode.
 * Default source is the tier (Phase T): `full_pca` → centralized appendix;
 * everything else (light commercial, unknown, absent) → inline residential
 * default. A valid per-inspection override is the only escape hatch and wins;
 * an invalid override is ignored.
 */
export function derivePhotoMode(input: { reportTier?: string | null; override?: string | null }): PhotoMode {
  if (input.override === 'appendix' || input.override === 'inline') return input.override;
  return input.reportTier === 'full_pca' ? 'appendix' : 'inline';
}
