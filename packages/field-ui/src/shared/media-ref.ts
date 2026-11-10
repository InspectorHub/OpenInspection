/**
 * What names a media entry. One order everywhere (the reorder, the load into the document, the merge with the loader's list): the
 * file key, then the media id (R2 clip), then the stream uid (Stream clip), then the pending id (a photo still being uploaded).
 * Null when the entry has no name at all.
 */
export function mediaIdentity(
  e: { key?: string | undefined; mediaId?: string | undefined; streamUid?: string | undefined; pendingId?: string | undefined },
): { field: "key" | "mediaId" | "streamUid" | "pendingId"; value: string } | null {
  if (e.key) return { field: "key", value: e.key };
  if (e.mediaId) return { field: "mediaId", value: e.mediaId };
  if (e.streamUid) return { field: "streamUid", value: e.streamUid };
  if (e.pendingId) return { field: "pendingId", value: e.pendingId };
  return null;
}

const PREFIX = { key: "", mediaId: "m:", streamUid: "s:", pendingId: "p:" } as const;

/**
 * The name a media entry goes by when a list of them is ordered or compared. A photo is named by its file key. A clip has no file
 * key, and a pending photo has none yet, so they are named by their own identity, with a prefix a photo key never starts with:
 * `m:` media id, `s:` stream uid, `p:` pending id. Empty when the entry has no name at all.
 */
export function mediaRef(e: { key?: string | undefined; mediaId?: string | undefined; streamUid?: string | undefined; pendingId?: string | undefined }): string {
  const id = mediaIdentity(e);
  return id ? `${PREFIX[id.field]}${id.value}` : "";
}
