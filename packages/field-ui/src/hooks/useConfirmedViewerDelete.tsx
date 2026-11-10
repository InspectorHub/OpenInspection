import { useState, type ReactNode } from "react";
import { useActionLatch } from "@core/shared-ui";
import { ConfirmDialog } from "../components/ConfirmDialog";
import type { MediaAction } from "../components/media-studio/MediaViewer";
import type { GalleryPhoto } from "../shared/inspection-media";
import { m } from "../i18n";

/**
 * The viewer's Delete asks first. The viewer closes when an action is pressed, so the question is asked here, outside
 * it, about the photo that was on screen; only the confirmation performs the delete (once: a second press in the same
 * frame is dropped), and Cancel or Escape leaves everything as it was. Every other action passes straight through.
 */
export function useConfirmedViewerDelete(
  act: (action: MediaAction, photo: GalleryPhoto) => void,
): { onAction: (action: MediaAction, photo: GalleryPhoto) => void; dialog: ReactNode } {
  const [pending, setPending] = useState<GalleryPhoto | null>(null);
  const latch = useActionLatch(false);
  const video = pending?.mediaType === "video";
  const dialog = (
    <ConfirmDialog
      open={pending !== null}
      title={video ? m.media_delete_video_title() : m.media_delete_photo_title()}
      message={video ? m.media_delete_video_body() : m.media_delete_photo_body()}
      onCancel={() => setPending(null)}
      onConfirm={() => latch(() => {
        const photo = pending;
        setPending(null);
        if (photo) act("delete", photo);
      })}
    />
  );
  return { onAction: (action, photo) => (action === "delete" ? setPending(photo) : act(action, photo)), dialog };
}
