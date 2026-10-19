/**
 * Free a video's stored object (Stream or R2) through the media DELETE, which
 * takes a Stream UID or an R2 media id and resolves the backend per provider.
 * True when it is gone: deleted now, or already gone (404). Anything else, a
 * refusal or a request that never arrived, is false so the caller keeps the
 * entry that still points at the object.
 */
export async function freeVideoMedia(inspectionId: string, videoRef: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/inspections/${inspectionId}/media/video/${encodeURIComponent(videoRef)}`, {
      method: "DELETE",
      credentials: "include",
    });
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}
