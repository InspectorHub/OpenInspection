import type { CollabFindingsApi } from '../collab/collab-findings-api';
import type { MediaFileResult } from '../media-types';

/** The part of a settled batch the attach needs. */
export interface AttachableBatch {
  itemId: string;
  targetType: 'item' | 'defect';
  customId: string;
  defectKind: 'canned' | 'custom';
  keys: string[];
  results: MediaFileResult[];
  pendingIds: string[];
}

/**
 * Attach a settled batch's stored photos to its item or defect row.
 *
 * A file the host kept on the device is written into the results document by the host at once, while the stored files are
 * attached here only after the whole batch settled (and appended at the end). So on an item the document would read kept
 * photos first, then the successes. After attaching, the batch's photos on the item are put back in selection order, the
 * first selected photo (the default cover) included. Photos of the item that are not part of the batch keep their places.
 */
export function attachPhotoBatch(findings: Pick<CollabFindingsApi, 'addPhotoToItem' | 'addPhotoToDefect' | 'orderPhotoBatch'>, d: AttachableBatch): void {
  if (!d.keys.length || !d.itemId) return;
  for (const k of d.keys) {
    if (d.targetType === 'defect' && d.customId) {
      findings.addPhotoToDefect(d.itemId, { kind: d.defectKind, id: d.customId }, k);
    } else {
      findings.addPhotoToItem(d.itemId, k);
    }
  }
  if (d.targetType === 'defect' && d.customId) return;
  findings.orderPhotoBatch(
    d.itemId,
    d.results.flatMap<{ key?: string; pendingId?: string }>((r) => (r.ok && r.key ? [{ key: r.key }] : r.kept === true && d.pendingIds[r.index] ? [{ pendingId: d.pendingIds[r.index] }] : [])),
  );
}
