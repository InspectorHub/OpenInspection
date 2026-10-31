import type { FieldDataSource } from '../data-source';
import { m } from '../i18n';
import { photoRefusal } from '../shared/photo-admission';

/**
 * Tells a crop or annotation dialog what to do once its image has been checked. `mayClose` is false when the image was
 * refused or an earlier save of the same photo is still out (the dialog stays, with the person's work in it), true
 * otherwise. Called once per save. Answering `false` calls the save off (the dialog was cancelled meanwhile).
 */
export type OnChecked = (mayClose: boolean) => boolean | void;

/**
 * Decides whether a photo edit (crop or annotation) can be sent, and when it cannot, tells the user why and
 * answers `true` (dropped). Each reason has its own sentence:
 * - busy: a save of the same photo is still out (the repeat is dropped);
 * - no photo: the item or its photo cannot be addressed (nothing to save to);
 * - no document: the inspection's live results document is not connected yet.
 * Nothing is saved, so nothing may be shown as saved: callers check this before any optimistic change.
 * `onChecked(mayClose)` tells the caller's dialog what to do. A save that does not happen keeps the dialog open with the
 * person's work in it: a repeat of a save still out (the first closes it), and no live document yet (it will connect).
 * The one exception is a photo that no longer exists: there is nothing left to crop or draw on, so the dialog closes.
 */
export function dropMediaSave(
  dataSource: Pick<FieldDataSource, 'notify'>,
  inFlight: Set<string>,
  saveKey: string,
  target: { fk: string | null; originalKey: string | undefined; doc: unknown },
  onChecked?: OnChecked,
): boolean {
  let mayClose = false;
  if (inFlight.has(saveKey)) dataSource.notify(m.editor_photo_save_busy(), 'info');
  else if (!target.fk || !target.originalKey) { dataSource.notify(m.editor_photo_save_no_photo(), 'error'); mayClose = true; }
  else if (!target.doc) dataSource.notify(m.editor_photo_save_no_document(), 'error');
  else return false;
  onChecked?.(mayClose);
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
 * BEFORE it is queued, sent or shown as saved, and says why with a fixed sentence. Answers `true` when the caller must stop
 * (it refused, or `onChecked` called the save off).
 * The same check, from the same source, as the pending store applies to a picked photo, so the problem is never
 * left for the drain to find later.
 */
export async function refuseInadmissibleImage(dataSource: Pick<FieldDataSource, 'notify'>, blob: Blob, onChecked?: OnChecked): Promise<boolean> {
  let refusal: Awaited<ReturnType<typeof photoRefusal>>;
  try {
    refusal = await photoRefusal(blob);
  } catch (err) {
    onChecked?.(false); // a check that threw leaves the dialog open and its owner free to try again
    throw err;
  }
  // `onChecked` answers `false` to call the save off (the dialog was cancelled meanwhile): stop, and say nothing about
  // an image nobody is waiting on any more. Asked BEFORE the refusal is announced for that reason.
  if (onChecked?.(refusal === null) === false) return true;
  if (refusal === null) return false;
  dataSource.notify(refusal === 'TOO_LARGE' ? m.editor_photo_save_too_large() : m.editor_photo_save_unsupported_type(), 'error');
  return true;
}
