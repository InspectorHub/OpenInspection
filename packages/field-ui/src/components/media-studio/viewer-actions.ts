import { ALL_MEDIA_ACTIONS, type MediaAction } from "./MediaViewer";
import type { GalleryPhoto } from "../../shared/inspection-media";

/**
 * The viewer actions the item strip leaves out for the photo on screen. Rotate and Caption have no handler in the editor
 * (pressed, they only closed the viewer), so they are never offered. A photo that exists only in the local pending
 * store has no stored image yet (no base key), so there is nothing for the studio to draw on: Annotate is not offered
 * rather than shown dead. A pending crop or annotation keeps its base key and stays annotatable.
 */
export function viewerHiddenActions(
  viewed: GalleryPhoto | undefined,
  opts: { readOnly: boolean; video: boolean },
): readonly MediaAction[] | undefined {
  if (opts.readOnly) return ALL_MEDIA_ACTIONS;
  const hidden: MediaAction[] = ["rotate", "caption"];
  if (!opts.video) hidden.push("poster");
  if (viewed?.pending && !viewed.originalKey) hidden.push("annotate");
  return hidden;
}
