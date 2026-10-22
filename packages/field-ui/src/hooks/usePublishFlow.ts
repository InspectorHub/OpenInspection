import { useCallback, useState } from 'react';
import { isIgnored, useFieldCommand, useFieldDataSource } from '../context';
import { m } from '../i18n';

export interface PublishFlowOptions {
  /**
   * Asks the host to confirm a person is present (a human check) before the publish goes out.
   * Resolving false abandons the publish: nothing is sent and no state changes.
   */
  confirmHuman?: () => Promise<boolean>;
  /**
   * The publish also marks the on-site work complete. Called BEFORE the request, because the editor's
   * inspection copy is frozen at mount and the status badge has to move without a reload. Not called for
   * a publish that is about to be dropped (another publish is still in flight).
   */
  onMarkedComplete: () => void;
  /** The publish succeeded: close the dialog. The flow itself reloads the editor data. */
  onPublished: () => void;
  /** Finish fieldwork succeeded: patch the status locally. The flow itself reloads the editor data. */
  onFieldworkFinished: () => void;
}

/** What the publish dialog collects besides the auto-sign flag. */
export interface PublishExtras {
  /** The revision reason, already trimmed; absent for a first publish or a blank box. */
  summary?: string;
}

export interface PublishFlow {
  publish(markComplete: boolean, extras: PublishExtras, autoSign: boolean): Promise<void>;
  /** True while a publish is out. */
  publishing: boolean;
  /** The sentence the dialog shows when the last publish was refused, or null. */
  publishError: string | null;
  clearPublishError(): void;
  finishFieldwork(): Promise<void>;
  /** The sentence for the last refused "Finish fieldwork", or null. Cleared when the next attempt starts. */
  finishError: string | null;
  /** True while "Finish fieldwork" is out. */
  finishing: boolean;
}

/**
 * The two lifecycle writes of the editor header: publish and "Finish fieldwork".
 *
 * Each has its own `useFieldCommand`, so marking the work complete never waits behind (or swallows) a
 * publish and vice versa; within one, a second call in the same frame is dropped by the command's own
 * guard and does nothing: no error, no dialog change, no status patch. A dropped call is checked FIRST
 * (`isIgnored`) because the first request is still running and will land on its own.
 *
 * Both reload the editor data on success, as the route did when it revalidated. A refused publish keeps the
 * dialog open and shows the server's reason (or a generic sentence when it gave none); a refused
 * "Finish fieldwork" is reported through `finishError` for the host to show.
 */
export function usePublishFlow(inspectionId: string, options: PublishFlowOptions): PublishFlow {
  const dataSource = useFieldDataSource();
  const publishCmd = useFieldCommand(inspectionId);
  const completeCmd = useFieldCommand(inspectionId);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [finishError, setFinishError] = useState<string | null>(null);
  const clearPublishError = useCallback(() => setPublishError(null), []);

  async function publish(markComplete: boolean, extras: PublishExtras, autoSign: boolean): Promise<void> {
    if (publishCmd.isBusy()) return;
    if (options.confirmHuman && !(await options.confirmHuman())) return;
    setPublishError(null);
    if (markComplete && !publishCmd.isBusy()) options.onMarkedComplete();
    // The auto-sign choice rides ALONG WITH the publish, never beside it: the handler re-reads the
    // inspection to decide whether to sign, so a separate write could land after that read and publish unsigned.
    const result = await publishCmd.run({
      type: 'publish',
      autoSignOnPublish: autoSign,
      ...(markComplete ? { markComplete: true } : {}),
      ...(extras.summary ? { summary: extras.summary } : {}),
    });
    if (isIgnored(result)) return;
    if (result.ok) {
      setPublishError(null);
      options.onPublished();
      dataSource.reload();
    } else {
      setPublishError(result.error ?? m.editor_publish_failed());
    }
  }

  async function finishFieldwork(): Promise<void> {
    // Read the guard before touching state: a repeat that will be dropped must not wipe a standing error.
    if (completeCmd.isBusy()) return;
    setFinishError(null);
    const result = await completeCmd.run({ type: 'complete' });
    if (isIgnored(result)) return;
    if (result.ok) {
      options.onFieldworkFinished();
      dataSource.reload();
    } else {
      setFinishError(result.error ?? m.editor_finish_fieldwork_error());
    }
  }

  return {
    publish,
    publishing: publishCmd.busy,
    publishError,
    clearPublishError,
    finishFieldwork,
    finishError,
    finishing: completeCmd.busy,
  };
}
