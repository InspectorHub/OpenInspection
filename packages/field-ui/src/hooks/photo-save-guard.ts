import type { FieldDataSource } from '../data-source';
import { m } from '../i18n';
import { photoRefusal } from '../shared/photo-admission';

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
 * synchronously here, so a second call in the same frame sees it. A task that REJECTS is reported to the
 * person (the edit was applied on screen optimistically and did not reach the inspection) instead of
 * surfacing as an unhandled rejection nobody sees; the optimistic state stays as the caller left it.
 */
export function guardedSave(
  dataSource: Pick<FieldDataSource, 'notify'>,
  inFlight: Set<string>,
  key: string,
  task: () => Promise<unknown>,
): void {
  inFlight.add(key);
  let started: Promise<unknown>;
  try {
    started = task();
  } catch (err) {
    started = Promise.reject(err);
  }
  void started
    .catch(() => {
      dataSource.notify(m.editor_photo_save_failed(), 'error');
    })
    .finally(() => {
      inFlight.delete(key);
    });
}

/**
 * Refuses an edited image the server would permanently refuse (over the photo ceiling, or not an image by its bytes)
 * BEFORE it is queued, sent or shown as saved, and says why with a fixed sentence. Answers `true` when it refused.
 * The same check, from the same source, as the pending store applies to a picked photo, so the problem is never
 * left for the drain to find later.
 */
export async function refuseInadmissibleImage(dataSource: Pick<FieldDataSource, 'notify'>, blob: Blob): Promise<boolean> {
  const refusal = await photoRefusal(blob);
  if (refusal === null) return false;
  dataSource.notify(refusal === 'TOO_LARGE' ? m.editor_photo_save_too_large() : m.editor_photo_save_unsupported_type(), 'error');
  return true;
}
