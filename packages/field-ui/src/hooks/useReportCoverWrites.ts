import { useCallback, useRef } from 'react';
import { isIgnored, useFieldDataSource } from '../context';
import type { FieldRunResult } from '../context';
import { m } from '../i18n';
import { useLatestWinsCommand } from './useLatestWinsCommand';

/** How long the "save failed" message stays up, as every other failed save of the editor. */
const FAILED_MS = 8000;

export interface ReportCoverWrites {
  /** Set the report cover to this photo key; an empty string clears it. The newest request wins. */
  setCover(coverPhotoId: string): void;
  /** Bake a crop of `sourceKey` as the cover. Latest wins; a repeat of the save already in flight sends nothing more. */
  cropCover(input: { sourceKey: string; crop: string; image: Blob }): void;
  /**
   * Save a photo annotation through the command channel (the route's fallback while the results document is
   * not live yet). Latest wins; a repeat of the save already in flight sends nothing more.
   */
  annotate(input: { itemId: string; photoIndex: number; nodes: string; image: Blob; sectionId?: string }): void;
}

/**
 * The editor's cover and annotation writes that do not go through the results document. They used to share
 * one route fetcher; each now has its own channel, and a write the host refuses is SAID (the fetcher
 * dropped every answer, so a failed cover save looked like a saved one).
 *
 * All three are latest-wins (`useLatestWinsCommand`): one request is in flight at a time, a newer DIFFERENT
 * request waits behind it and replaces any older queued one, and a request identical to the one in flight (a
 * repeated press of one Save in the same frame) joins it and sends nothing more. The page updates its own state
 * the moment the person saves, so a request must never be dropped for being the second: the final state on the
 * server is the last one the person made. A superseded request is silent (its answer is discarded with it).
 */
export function useReportCoverWrites(inspectionId: string): ReportCoverWrites {
  const dataSource = useFieldDataSource();
  const dataSourceRef = useRef(dataSource);
  dataSourceRef.current = dataSource;
  const { submit: submitCover } = useLatestWinsCommand(inspectionId);
  const { submit: submitCrop } = useLatestWinsCommand(inspectionId);
  const { submit: submitAnnotate } = useLatestWinsCommand(inspectionId);

  const report = useCallback((res: FieldRunResult<unknown>) => {
    if (isIgnored(res)) return;
    if (!res.ok) {
      dataSourceRef.current.notify(m.editor_route_save_failed(), 'error', { durationMs: FAILED_MS });
    }
  }, []);

  const setCover = useCallback(
    (coverPhotoId: string) => {
      void submitCover({ type: 'set-cover', coverPhotoId }).then(report);
    },
    [submitCover, report],
  );

  const cropCover = useCallback(
    (input: { sourceKey: string; crop: string; image: Blob }) => {
      void submitCrop({ type: 'crop-cover', sourceKey: input.sourceKey, crop: input.crop, image: input.image }).then(report);
    },
    [submitCrop, report],
  );

  const annotate = useCallback(
    (input: { itemId: string; photoIndex: number; nodes: string; image: Blob; sectionId?: string }) => {
      void submitAnnotate({ type: 'annotate', ...input }).then(report);
    },
    [submitAnnotate, report],
  );

  return { setCover, cropCover, annotate };
}
