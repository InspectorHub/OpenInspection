import { PhotoCropper, type PhotoCrop } from "./PhotoCropper";
import type { PixelCrop } from "./cropImage";
import { m } from "~/paraglide/messages";

type Aspect = "3:2" | "16:9" | "1.91:1" | "4:3";

export interface CoverCropperProps {
  sourceUrl: string;
  sourceKey: string;
  onCancel: () => void;
  onSave: (blob: Blob, crop: { aspect: Aspect; orientation: "landscape" | "portrait"; pixels: PixelCrop }) => void;
}

/** Thin wrapper over PhotoCropper that fixes the cover presets and disables the
 *  free-aspect option (covers must keep a constrained report ratio). */
export function CoverCropper({ sourceUrl, sourceKey, onCancel, onSave }: CoverCropperProps) {
  void sourceKey;
  return (
    <PhotoCropper
      sourceUrl={sourceUrl}
      presets={["3:2", "16:9", "1.91:1", "4:3"]}
      allowFree={false}
      initialAspect="3:2"
      title={m.media_cover_crop_title()}
      saveLabel={m.media_cover_crop_save()}
      onCancel={onCancel}
      onSave={(blob, c: PhotoCrop) => onSave(blob, { aspect: c.aspect as Aspect, orientation: c.orientation, pixels: c.pixels })}
    />
  );
}
