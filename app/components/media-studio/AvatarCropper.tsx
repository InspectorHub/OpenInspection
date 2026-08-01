import { PhotoCropper } from "./PhotoCropper";
import { m } from "~/paraglide/messages";

const AVATAR_EDGE = 512;

export interface AvatarCropperProps {
  sourceUrl: string;
  onCancel: () => void;
  onSave: (blob: Blob) => void;
}

/**
 * Thin wrapper over PhotoCropper that fixes the avatar's shape and size — the
 * same relationship CoverCropper has to it.
 *
 * It used to be a second copy of the cropper: its own Cropper, its own zoom
 * slider, its own bake. That copy is why rotation, once added, would have
 * reached inspection photos and cover images and not a profile photo — and a
 * profile photo, taken by whoever was standing there with a phone, is the one
 * most likely to arrive sideways.
 */
export function AvatarCropper({ sourceUrl, onCancel, onSave }: AvatarCropperProps) {
  return (
    <PhotoCropper
      sourceUrl={sourceUrl}
      presets={["1:1"]}
      allowFree={false}
      cropShape="round"
      maxLongEdge={AVATAR_EDGE}
      title={m.media_avatar_crop_aria()}
      saveLabel={m.media_avatar_save()}
      onCancel={onCancel}
      onSave={(blob) => onSave(blob)}
    />
  );
}
