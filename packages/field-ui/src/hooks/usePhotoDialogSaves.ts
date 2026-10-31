import { useCallback, useEffect, useRef } from "react";
import { useFieldDataSource } from "../context";
import { m } from "../i18n";
import { refuseInadmissibleImage } from "./photo-save-guard";
import type { usePhotoOps } from "./usePhotoOps";
import type { useReportCoverWrites } from "./useReportCoverWrites";

type PhotoOps = ReturnType<typeof usePhotoOps>;
type CropTarget = NonNullable<PhotoOps["photoCropTarget"]>;

/**
 * What the lightbox crop dialog and the Photo Studio do with a Save. Each closes only once the save's image check has
 * passed: a refused image leaves the dialog open with the crop box or the strokes in it, so the person can adjust or
 * cancel. The check is asynchronous, so each Save is one attempt held in a ref:
 *  - a second press of the same dialog's Save while the attempt is out is dropped without a word (the first is saving
 *    fine, so a "save busy" notice would be wrong);
 *  - cancelling or closing the dialog drops the attempt, and everything it would still have done (the warning, the
 *    save, the close) is called off, so a cancelled crop is never saved and never closes a dialog opened afterwards;
 *  - a check that throws, or a save that throws before it starts, says the save failed and frees the dialog for another try;
 *  - an ADMITTED attempt keeps the slot until the dialog has really closed (the effects below watch the committed state),
 *    so a press in the frame between the close being requested and React committing it is dropped like any repeat.
 */
export function usePhotoDialogSaves(a: {
  performPhotoCropSave: PhotoOps["performPhotoCropSave"];
  performPhotoAnnotationSave: PhotoOps["performPhotoAnnotationSave"];
  setPhotoCropTarget: PhotoOps["setPhotoCropTarget"];
  setRecropWarn: PhotoOps["setRecropWarn"];
  setStudioOpen: (open: boolean) => void;
  annotateChecked: ReturnType<typeof useReportCoverWrites>["annotateChecked"];
  photoCropTarget: PhotoOps["photoCropTarget"];
  studioOpen: boolean;
}) {
  const { performPhotoCropSave, performPhotoAnnotationSave, setPhotoCropTarget, setRecropWarn, setStudioOpen, annotateChecked, photoCropTarget, studioOpen } = a;
  const dataSource = useFieldDataSource();
  const cropAttempt = useRef<object | null>(null);
  const studioAttempt = useRef<object | null>(null);

  // A dialog that is gone has no attempt left to protect: this is what frees the slot after an admitted save.
  useEffect(() => { if (!photoCropTarget) cropAttempt.current = null; }, [photoCropTarget]);
  useEffect(() => { if (!studioOpen) studioAttempt.current = null; }, [studioOpen]);

  /** Starts an attempt; `null` when this dialog's previous Save is still being checked. */
  const begin = (slot: typeof cropAttempt) => {
    if (slot.current) return null;
    const attempt = {};
    slot.current = attempt;
    const live = () => slot.current === attempt;
    const settle = () => { if (live()) slot.current = null; };
    const failed = () => { if (live()) { settle(); dataSource.notify(m.editor_photo_save_failed(), "error"); } };
    return { live, settle, failed };
  };

  const cancelCrop = useCallback(() => { cropAttempt.current = null; setPhotoCropTarget(null); }, [setPhotoCropTarget]);
  const closeStudio = useCallback(() => { studioAttempt.current = null; setStudioOpen(false); }, [setStudioOpen]);

  const saveCrop = (target: CropTarget, blob: Blob, crop: Parameters<PhotoOps["performPhotoCropSave"]>[2]) => {
    const t = begin(cropAttempt);
    if (!t) return;
    // Only clears the dialog this save was started for (the person may have opened another photo's crop meanwhile).
    const close = () => setPhotoCropTarget((cur) => (cur === target ? null : cur));
    try {
      if (!target.hasAnnotation) {
        // Admitted: the slot stays held until the dialog has really closed (see the effect above); refused or dropped
        // for a reason that keeps the dialog open: the slot is freed so Save works again.
        performPhotoCropSave(target, blob, crop, (mayClose) => {
          if (!t.live()) return false;
          if (mayClose) close(); else t.settle();
        });
        return;
      }
      // Discarding an annotation asks first, so the image is checked before the question, with the dialog still open.
      refuseInadmissibleImage(dataSource, blob, () => (t.live() ? undefined : false)).then((refused) => {
        if (!t.live()) return;
        if (refused) { t.settle(); return; }
        close();
        setRecropWarn({ run: () => performPhotoCropSave(target, blob, crop) });
      }, t.failed);
    } catch { t.failed(); }
  };

  const saveAnnotation = (
    target: Parameters<PhotoOps["performPhotoAnnotationSave"]>[0], blob: Blob, nodesJson: string,
  ) => {
    const t = begin(studioAttempt);
    if (!t) return;
    try {
      const handled = performPhotoAnnotationSave(target, blob, nodesJson, (mayClose) => {
        if (!t.live()) return false;
        if (mayClose) setStudioOpen(false); else t.settle();
      });
      if (handled) return;
      // The brief window before the results document is live: the online relay, checked the same way.
      annotateChecked({ itemId: target.itemId, photoIndex: target.photoIndex, nodes: nodesJson, image: new File([blob], "annotated.png", { type: "image/png" }), ...(target.sectionId ? { sectionId: target.sectionId } : {}) },
        // A studio closed meanwhile is no longer waiting: its refusal is not announced.
        () => (t.live() ? undefined : false))
        .then((ok) => { if (!t.live()) return; if (ok) setStudioOpen(false); else t.settle(); }, t.failed);
    } catch { t.failed(); }
  };

  return { saveCrop, cancelCrop, saveAnnotation, closeStudio };
}
