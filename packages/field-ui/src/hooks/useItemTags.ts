import { useCallback, useEffect, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { useFieldDataSource } from '../context';
import { m } from '../i18n';
import type { ItemTagMap } from '../data-source-types';

type ItemTag = { id: string; name: string; color?: string };

/**
 * The tags on each checklist item. Reads them when the editor opens and saves every toggle through
 * `FieldDataSource.resources.itemTags` (the web host serves it from `/resources/inspection-item-tags`).
 *
 * The chips change on screen at once; a write the host did not store is taken back and said so, rather
 * than left standing as a tag that will be gone after a reload. A host with no `itemTags` gets what the
 * editor always had: chips held in memory for the session, nothing sent.
 */
export function useItemTags(inspectionId: string, setTagsByItem: Dispatch<SetStateAction<ItemTagMap>>) {
  const dataSource = useFieldDataSource();
  const store = dataSource.resources.itemTags;
  const notify = dataSource.notify;
  /** The toggles waiting for the host's answer, as `itemId:tagId`. A repeat of one of them is not sent again. */
  const inflight = useRef(new Set<string>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!store || !inspectionId) return;
    let live = true;
    void store.list(inspectionId).then(
      (saved) => {
        // `null` is "could not read": keep what is shown. An item the inspector already touched wins over the answer.
        if (!live || !saved) return;
        setTagsByItem((prev) => ({ ...saved, ...prev }));
      },
      () => { /* a failed read keeps what is shown, like every other read of the editor */ },
    );
    return () => { live = false; };
  }, [store, inspectionId, setTagsByItem]);

  const toggle = useCallback((itemId: string, tag: ItemTag, current: ItemTag[]) => {
    const key = `${itemId}:${tag.id}`;
    // Decided before anything changes: two presses in one frame both see the same `current`, so the second must
    // not be sent as another attach. Writing is idempotent on the host, but a repeat would still race the rollback.
    if (inflight.current.has(key)) return;
    const attach = !current.some((t) => t.id === tag.id);
    const apply = (adding: boolean) =>
      setTagsByItem((prev) => {
        const rest = (prev[itemId] ?? []).filter((t) => t.id !== tag.id);
        return { ...prev, [itemId]: adding ? [...rest, tag] : rest };
      });
    apply(attach);
    if (!store || !inspectionId) return;

    inflight.current.add(key);
    const write = attach ? store.add(inspectionId, itemId, tag.id) : store.remove(inspectionId, itemId, tag.id);
    void Promise.resolve(write)
      .then((result) => result.ok, () => false)
      .then((stored) => {
        inflight.current.delete(key);
        if (stored || !mounted.current) return;
        apply(!attach);
        notify(m.editor_route_save_failed(), 'error', { durationMs: 8000 });
      });
  }, [store, inspectionId, setTagsByItem, notify]);

  return { toggle };
}
