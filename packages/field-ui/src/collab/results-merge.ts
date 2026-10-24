/**
 * Merging the client's results document into the editor's results BEFORE the document has synced with the
 * server's copy.
 *
 * First paint uses the loader's results. The client document is not filled from them (only the server's
 * document is, and the client receives that on its first sync), so until that sync the client document is
 * empty apart from what the user wrote locally. Adopting its projection wholesale at that point would replace
 * every finding the page shows with an almost empty map: the first write (attaching a photo) made the ratings
 * and notes of the whole inspection vanish from the page.
 *
 * So until the sync, the document's projection is laid over the loader's results finding by finding, and only
 * for what the document actually holds:
 * - a scalar (rating, notes, value, recommendation) the user wrote, an empty one included (a cleared rating
 *   clears it); a scalar never written is left as the loader has it;
 * - a collection (attributes, canned comments, recommendations, custom comments) that holds something replaces
 *   the loader's; an empty one is the seeded default and changes nothing;
 * - photos: the document's photos are added to the loader's (a document photo wins over the loader's entry
 *   with the same key; a local pending entry that no longer exists in the document is dropped).
 * After the first sync the document is authoritative again and its projection is adopted whole, which is what
 * lets another collaborator's deletion of a finding arrive.
 */
import * as Y from 'yjs';
import { projectResults } from '../shared/results-doc';
import { parseFindingKey } from '../shared/finding-key';
import type { ResultMap } from '../hooks/useInspection';

const SCALARS = ['rating', 'notes', 'value', 'recommendation'] as const;
const COLLECTIONS = ['attributes', 'tabs', 'recommendations', 'customComments'] as const;

type Entry = Record<string, unknown>;
type Photo = { key?: string; pendingId?: string } & Entry;

function mergePhotos(before: Photo[], docPhotos: Photo[]): Photo[] {
  const docKeys = new Set(docPhotos.flatMap((p) => (p.key ? [p.key] : [])));
  const kept = before.filter((p) => !p.pendingId && !(p.key && docKeys.has(p.key)));
  return [...kept, ...docPhotos];
}

export function mergeUnsyncedResults(prev: ResultMap, doc: Y.Doc): ResultMap {
  const projection = projectResults(doc) as Record<string, Entry>;
  const out: ResultMap = { ...prev };
  doc.getMap<unknown>('results').forEach((raw, key) => {
    if (!(raw instanceof Y.Map)) return;
    const { itemId, unitId } = parseFindingKey(key);
    const projected = projection[key] ?? {};
    const merged: Entry = { ...((prev[key] ?? (unitId === '_default' ? prev[itemId] : undefined) ?? {}) as Entry) };
    for (const field of SCALARS) {
      if (!raw.has(field)) continue;
      if (field in projected) merged[field] = projected[field];
      else delete merged[field];
    }
    for (const field of COLLECTIONS) {
      if (field in projected) merged[field] = projected[field];
    }
    const docPhotos = projected.photos as Photo[] | undefined;
    if (docPhotos && docPhotos.length > 0) {
      merged.photos = mergePhotos((merged.photos as Photo[] | undefined) ?? [], docPhotos);
    }
    out[key] = merged;
    if (unitId === '_default') out[itemId] = merged;
  });
  return out;
}
