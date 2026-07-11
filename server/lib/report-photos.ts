/** Minimal view of a resolved report photo (as produced by mapReportPhoto). */
export interface ReportPhotoLike {
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
