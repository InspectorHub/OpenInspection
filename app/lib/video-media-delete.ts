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

/**
 * What identifies a video entry in the results, for removing it after its stored object is freed.
 *
 * A Stream video has no R2 `key` (it is ''), so it is matched by the id that was freed
 * (`streamUid`, or `mediaId` for an R2 video), never by position: the list can change while
 * the delete is in flight, and a match on an empty key would take any keyless entry.
 * Position is the last resort, for an entry with no identity at all.
 */
export function videoEntryIdentity(
  photo: { key: string; originalKey?: string; provider?: "stream" | "r2"; streamUid?: string; mediaId?: string },
  idx: number,
) {
  const idField = photo.provider === "r2" ? "mediaId" : "streamUid";
  const videoRef = photo[idField];
  const docKey = photo.originalKey || photo.key;
  const isIt = (p: { key: string; streamUid?: string; mediaId?: string }, i: number): boolean =>
    docKey ? p.key === docKey : videoRef ? p[idField] === videoRef : i === idx;
  return { videoRef, docKey, idField, isIt } as const;
}

