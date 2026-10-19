/**
 * Free a video's stored object (Stream or R2) through the media DELETE, which
 * takes a Stream UID or an R2 media id and resolves the backend per provider.
 * True when it is gone: deleted now, or already gone (404). Anything else, a
 * refusal or a request that never arrived, is false so the caller keeps the
 * entry that still points at the object. Null when a delete of the same video is
 * already in flight (a second click starts nothing and has nothing to report).
 *
 * Not settled: whether Stream answers 404 or 500 for a video that was already
 * removed. A 404 is treated as gone; a 500 for a gone video would show the error
 * toast and leave the entry, which is the safe side of the doubt.
 */
const inFlight = new Set<string>();

export async function freeVideoMedia(inspectionId: string, videoRef: string): Promise<boolean | null> {
  const key = `${inspectionId}/${videoRef}`;
  if (inFlight.has(key)) return null;
  inFlight.add(key);
  try {
    const res = await fetch(`/api/inspections/${inspectionId}/media/video/${encodeURIComponent(videoRef)}`, {
      method: "DELETE",
      credentials: "include",
    });
    return res.ok || res.status === 404;
  } catch {
    return false;
  } finally {
    inFlight.delete(key);
  }
}
