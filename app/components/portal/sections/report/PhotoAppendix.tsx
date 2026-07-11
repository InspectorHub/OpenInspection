import type { AppendixPhoto } from "./types";
import { printThumbWidth, PRINT_FIGURE_CLASS } from "./types";

/**
 * Commercial PCA Phase P — centralized photo appendix (Appendix B). Full-PCA
 * reports keep the body text-only and collect every photo here, continuously
 * numbered (`Photo N.`), in a ~2×3 grid with captions. Each figure carries an
 * `id="photo-N"` anchor so the body's PHOTO NO. pointer (and the cost reserve
 * table's PHOTO NO. column) can link to it. Renders nothing when empty.
 * Thumbnails use `printThumbWidth` to keep the appendix — the document's main
 * size driver — lean for PDF/Word (ties to Phase W + the 128 MB ceiling).
 *
 * lint:ds — only `ih-*` design tokens; raw Tailwind colors are forbidden.
 */
export function PhotoAppendix({ photos, isPrint }: { photos: AppendixPhoto[]; isPrint: boolean }) {
  if (!photos.length) return null;
  const w = printThumbWidth(isPrint);
  return (
    <section className="mt-10 print:break-before-page" aria-labelledby="appendix-b-heading">
      <h2 id="appendix-b-heading" className="mb-4 text-lg font-semibold text-ih-fg-1">
        Appendix B — Photographs
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 print:grid-cols-3">
        {photos.map((p) => (
          <figure key={p.photoNo} id={`photo-${p.photoNo}`} className={`${PRINT_FIGURE_CLASS} text-sm`}>
            <img
              src={`${p.url}&w=${w}`}
              alt={`${p.itemLabel} — ${p.sectionTitle}`}
              className="aspect-[4/3] w-full rounded-md border border-ih-border object-cover"
              loading="lazy"
            />
            <figcaption className="mt-1">
              <span className="font-semibold text-ih-fg-1">Photo {p.photoNo}.</span>{" "}
              <span className="text-ih-fg-3">{p.caption ?? `${p.sectionTitle} — ${p.itemLabel}`}</span>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
