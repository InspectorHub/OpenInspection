/**
 * The full-bleed photo overlay a reader gets by tapping a report photo.
 *
 * Extracted from <ReportView> when the printed two-half render pushed that
 * component past the large-file limit, and it is a good seam rather than a
 * convenient one: this is a screen-only affordance with a single input and a
 * single event, and it has nothing to say about a document that will be printed.
 *
 * Renders nothing when no photo is open, so the caller stays a one-liner.
 */
export function ReportLightbox({
  url,
  onClose,
}: {
  url: string | null;
  onClose: () => void;
}) {
  if (!url) return null;
  return (
    <div
      /* ds-allow: customer report render surface, not app chrome — fixed-dark image lightbox */
      className="fixed inset-0 z-[60] bg-[rgba(15,23,42,0.9)] flex items-center justify-center p-4 cursor-pointer"
      onClick={onClose}
    >
      <img src={url} alt="" className="max-w-full max-h-[90vh] object-contain rounded-lg" />
    </div>
  );
}
