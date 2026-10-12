import { useRef } from "react";
import { useDialogBehavior } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

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
  const ref = useRef<HTMLDivElement>(null);
  // Hook runs before the early return: Escape, Tab trap, scroll lock and focus return
  // follow `url`, and a click anywhere still closes.
  useDialogBehavior(!!url, onClose, ref);
  if (!url) return null;
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={m.editor_settings_cover_photo_alt()}
      /* ds-allow: customer report render surface, not app chrome — fixed-dark image lightbox */
      className="fixed inset-0 z-[60] bg-[rgba(15,23,42,0.9)] flex items-center justify-center p-4 cursor-pointer outline-none"
      onClick={onClose}
    >
      <img src={url} alt="" className="max-w-full max-h-[90vh] object-contain rounded-lg" />
    </div>
  );
}
