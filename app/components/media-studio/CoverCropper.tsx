import { PhotoCropper, type PhotoCrop } from "./PhotoCropper";
import type { PixelCrop } from "./cropImage";
import { m } from "~/paraglide/messages";

type Aspect = "3:2" | "16:9" | "1.91:1" | "4:3";

/**
 * `inspections.cover_crop` as it is stored — a FLAT rect, not `PhotoCrop`'s
 * nested `pixels`. Kept flat in the column because that is one object to read
 * and write; unflattened here so no call site has to know the difference.
 */
export interface StoredCoverCrop {
  aspect: Aspect;
  orientation: "landscape" | "portrait";
  x: number; y: number; width: number; height: number;
}

/**
 * The saved crop to re-open with, or null.
 *
 * ⚠️ The guard is the point, not the lookup. A crop rect is in the SOURCE
 * image's pixel space, so restoring it while cropping a DIFFERENT photo would
 * frame a region of an image it was never measured against — a silently wrong
 * cover rather than a visibly wrong one. `inspections.cover_photo_id` holds the
 * source key (`inspection-annotations.service.ts` writes it from `sourceKey`),
 * so equality with the key being cropped is the whole test.
 *
 * Lives here, once, because both entry points — the settings sheet and the
 * gallery's "Set as cover" — need the same rule and neither should re-derive it.
 */
export function coverCropFor(
  inspection: Record<string, unknown> | null | undefined,
  sourceKey: string,
): StoredCoverCrop | null {
  if (!inspection || inspection.coverPhotoId !== sourceKey) return null;
  const raw = inspection.coverCrop;
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Partial<StoredCoverCrop>;
  return typeof c.x === "number" && typeof c.y === "number"
    && typeof c.width === "number" && typeof c.height === "number"
    && c.width > 0 && c.height > 0
    ? {
        aspect: (c.aspect ?? "3:2") as Aspect,
        orientation: c.orientation === "portrait" ? "portrait" : "landscape",
        x: c.x, y: c.y, width: c.width, height: c.height,
      }
    : null;
}

export interface CoverCropperProps {
  sourceUrl: string;
  sourceKey: string;
  /** The crop this cover was last saved with; null on a cover never cropped. */
  initialCrop?: StoredCoverCrop | null;
  onCancel: () => void;
  onSave: (blob: Blob, crop: { aspect: Aspect; orientation: "landscape" | "portrait"; pixels: PixelCrop }) => void;
}

/** Thin wrapper over PhotoCropper that fixes the cover presets and disables the
 *  free-aspect option (covers must keep a constrained report ratio). */
export function CoverCropper({ sourceUrl, sourceKey, initialCrop = null, onCancel, onSave }: CoverCropperProps) {
  void sourceKey;
  return (
    <PhotoCropper
      sourceUrl={sourceUrl}
      presets={["3:2", "16:9", "1.91:1", "4:3"]}
      allowFree={false}
      initialAspect="3:2"
      initialCrop={initialCrop
        ? {
            aspect: initialCrop.aspect,
            orientation: initialCrop.orientation,
            pixels: { x: initialCrop.x, y: initialCrop.y, width: initialCrop.width, height: initialCrop.height },
          }
        : null}
      title={m.media_cover_crop_title()}
      saveLabel={m.media_cover_crop_save()}
      onCancel={onCancel}
      onSave={(blob, c: PhotoCrop) => onSave(blob, { aspect: c.aspect as Aspect, orientation: c.orientation, pixels: c.pixels })}
    />
  );
}
