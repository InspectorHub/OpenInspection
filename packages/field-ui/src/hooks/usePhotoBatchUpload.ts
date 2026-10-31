import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { useFieldDataSource } from '../context';
import type { MediaFileResult, PendingMediaRecord, PhotoUploadMeta } from '../media-types';
import { photoRefusal } from '../shared/photo-admission';

/** The defect row an uploaded photo is pinned to instead of the item. */
interface PhotoBatchTarget {
  kind: 'canned' | 'custom';
  id: string;
}

/** One selection of photos: a file chooser pick or a burst, bound for one item (or one of its defect rows). */
export interface PhotoBatch {
  itemId: string;
  /** The composite results key of the item's finding. Online uploads do not read it; it completes the record. */
  findingKey: string;
  files: Blob[];
  target: PhotoBatchTarget | null;
}

/**
 * How one batch ended. The same fields the `upload-photo` action answered with, so the page's attach and toast
 * logic reads the same names: `keys` holds the stored keys of the files that succeeded, in input order, and
 * `results[i]` is file `i`'s own outcome.
 */
interface PhotoBatchOutcome {
  /** Every file was stored or kept on the device (and there was at least one, for an item). */
  ok: boolean;
  keys: string[];
  results: MediaFileResult[];
  /**
   * A file failed for a reason that may pass (connection, server error) and was not kept: the change is not saved. A file the host
   * permanently refused does NOT count, because there is nothing left to save; it is announced with its own reason instead.
   */
  unsaved: boolean;
  itemId: string;
  targetType: 'item' | 'defect';
  customId: string;
  defectKind: 'canned' | 'custom';
}

export interface PhotoBatchUploader {
  /** True from the first queued batch until the last one has finished. Render state only. */
  busy: boolean;
  /**
   * Batches that finished and were not consumed yet, oldest first. A new batch never replaces an earlier
   * answer: each one is kept until `consume` takes it, so no stored key is left unattached.
   */
  outcomes: readonly PhotoBatchOutcome[];
  /**
   * True when any batch of the current busy period failed (some file was neither stored, kept on the device nor permanently refused), however many batches
   * followed it and whether or not their outcomes were already consumed. A new period starts when a batch is
   * submitted while none is out. Read it when `busy` falls to false to decide between "saved" and "error".
   */
  failedSinceIdle: boolean;
  /** Drop the oldest `count` outcomes (the ones the caller has handled). */
  consume(count: number): void;
  /**
   * Queue a batch. Batches run one after another, so the server sees them in the order they were made and
   * none is dropped or cancelled by a later one. Inside a batch up to four files upload at once.
   */
  submit(batch: PhotoBatch): void;
}

/** Files of one batch uploaded at once: the bound the upload action used for its own fan-out. */
const CONCURRENCY = 4;

function newPendingId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `photo-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function metaOf(batch: PhotoBatch): PhotoUploadMeta {
  const base = { findingKey: batch.findingKey, itemId: batch.itemId };
  return batch.target === null
    ? { ...base, targetType: 'item' }
    : { ...base, targetType: 'defect', customId: batch.target.id, defectKind: batch.target.kind };
}

/**
 * Online photo upload for the editor, in the shape the route's upload fetcher had: a `busy` flag while a
 * batch is out, and an answer per batch to attach and report. It replaces that fetcher by uploading each file
 * through `FieldDataSource.media.uploader` (a photo is not a `FieldCommand`).
 *
 * Differences from the fetcher, all on purpose: a batch submitted while another is out WAITS instead of
 * cancelling it (the cancelled one's keys were never attached, though the files were stored); an upload that
 * never answers is abandoned by the host's own time limit and shows as a failed file; and a file that fails
 * does not stop its siblings, exactly as before.
 */
export function usePhotoBatchUpload(inspectionId: string, doc: Y.Doc | null): PhotoBatchUploader {
  const dataSource = useFieldDataSource();
  const dataSourceRef = useRef(dataSource);
  dataSourceRef.current = dataSource;
  const docRef = useRef(doc);
  docRef.current = doc;
  const inspectionRef = useRef(inspectionId);
  inspectionRef.current = inspectionId;

  const [pending, setPending] = useState(0);
  const [outcomes, setOutcomes] = useState<PhotoBatchOutcome[]>([]);
  const [failedSinceIdle, setFailedSinceIdle] = useState(false);
  /** Batches out right now, read synchronously: the state above lags a render. */
  const pendingRef = useRef(0);
  /** The tail of the queue: a new batch starts when it settles. */
  const tail = useRef<Promise<void>>(Promise.resolve());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const runBatch = useCallback(async (batch: PhotoBatch): Promise<PhotoBatchOutcome> => {
    const uploader = dataSourceRef.current.media.uploader(inspectionRef.current, docRef.current);
    const meta = metaOf(batch);
    const results: MediaFileResult[] = new Array<MediaFileResult>(batch.files.length);
    let next = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        const index = next;
        next += 1;
        if (index >= batch.files.length) return;
        const rec: PendingMediaRecord = {
          kind: 'photo',
          pendingId: newPendingId(),
          inspectionId: inspectionRef.current,
          blob: batch.files[index],
          createdAt: Date.now(),
          meta,
        };
        try {
          // The same check the server and the pending store apply: a file it would refuse never leaves the device, and
          // is answered with the same fixed code a server refusal carries (so the existing wording announces it once).
          const refusal = await photoRefusal(rec.blob);
          if (refusal !== null) {
            results[index] = { index, ok: false, error: refusal, permanent: true };
            continue;
          }
          const out = await uploader.upload(rec);
          results[index] = out.ok
            ? { index, ok: true, key: out.key }
            : { index, ok: false, error: out.error, ...(out.kept === true ? { kept: true } : {}), ...(out.permanent === true ? { permanent: true } : {}) };
        } catch {
          results[index] = { index, ok: false, error: 'EXCEPTION' };
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batch.files.length) }, () => worker()));
    const keys = results.filter((r) => r.ok && r.key !== undefined).map((r) => r.key as string);
    return {
      ok: batch.files.length > 0 && batch.itemId !== '' && results.every((r) => r.ok || r.kept === true),
      keys,
      results,
      unsaved: batch.files.length === 0 || batch.itemId === '' || results.some((r) => !r.ok && r.kept !== true && r.permanent !== true),
      itemId: batch.itemId,
      targetType: batch.target === null ? 'item' : 'defect',
      customId: batch.target?.id ?? '',
      defectKind: batch.target?.kind ?? 'canned',
    };
  }, []);

  const submit = useCallback(
    (batch: PhotoBatch) => {
      // A batch submitted while none is out starts a new busy period, so an old failure is forgotten.
      if (pendingRef.current === 0) setFailedSinceIdle(false);
      pendingRef.current += 1;
      setPending((n) => n + 1);
      tail.current = tail.current.then(async () => {
        let outcome: PhotoBatchOutcome;
        try {
          outcome = await runBatch(batch);
        } catch {
          outcome = {
            ok: false,
            keys: [],
            results: batch.files.map((_, index) => ({ index, ok: false, error: 'EXCEPTION' })),
            unsaved: true,
            itemId: batch.itemId,
            targetType: batch.target === null ? 'item' : 'defect',
            customId: batch.target?.id ?? '',
            defectKind: batch.target?.kind ?? 'canned',
          };
        }
        pendingRef.current -= 1;
        // After unmount nothing is rendered, so there is nothing to attach the keys to; the files stay stored.
        if (!mounted.current) return;
        if (outcome.unsaved) setFailedSinceIdle(true);
        setOutcomes((prev) => [...prev, outcome]);
        setPending((n) => n - 1);
      });
    },
    [runBatch],
  );

  const consume = useCallback((count: number) => {
    if (count > 0) setOutcomes((prev) => prev.slice(count));
  }, []);

  return { busy: pending > 0, outcomes, failedSinceIdle, consume, submit };
}
