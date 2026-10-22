import type { FieldDataSource } from '../data-source';
import { m } from '../i18n';

/**
 * Decides whether a photo edit (crop or annotation) can be sent, and when it cannot, tells the user why and
 * answers `true` (dropped). Each reason has its own sentence:
 * - busy: a save of the same photo is still out (the repeat is dropped);
 * - no photo: the item or its photo cannot be addressed (nothing to save to);
 * - no document: the inspection's live results document is not connected yet.
 * Nothing is saved, so nothing may be shown as saved: callers check this before any optimistic change.
 */
export function dropMediaSave(
  dataSource: Pick<FieldDataSource, 'notify'>,
  inFlight: Set<string>,
  saveKey: string,
  target: { fk: string | null; originalKey: string | undefined; doc: unknown },
): boolean {
  if (inFlight.has(saveKey)) dataSource.notify(m.editor_photo_save_busy(), 'info');
  else if (!target.fk || !target.originalKey) dataSource.notify(m.editor_photo_save_no_photo(), 'error');
  else if (!target.doc) dataSource.notify(m.editor_photo_save_no_document(), 'error');
  else return false;
  return true;
}

/**
 * Runs `task` while `key` is held in `inFlight`, and releases it when the task settles, whatever
 * the outcome. The caller checks `inFlight.has(key)` first and drops a repeat; the key is added
 * synchronously here, so a second call in the same frame sees it. A rejection of `task` is left
 * unhandled, exactly as the bare `void` chains this replaces left it.
 */
export function guardedSave(inFlight: Set<string>, key: string, task: () => Promise<unknown>): void {
  inFlight.add(key);
  void task().finally(() => {
    inFlight.delete(key);
  });
}
