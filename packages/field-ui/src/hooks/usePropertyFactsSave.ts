import { useCallback } from 'react';
import { useLatestWinsCommand } from './useLatestWinsCommand';

/**
 * The durable save of the property-facts strip (`PropertyInfoForm`'s `onCommit`).
 *
 * ONE latest-wins channel is lossless here, unlike the single-field writes beside it, because the form
 * hands over a FULL snapshot of every field each time: a later PATCH is a strict superset of any earlier
 * one. A commit made while another is in flight replaces any older queued one and is sent when the
 * in-flight one settles, so the server sees the writes in order and the last one is the newest snapshot.
 * (The fetcher this replaced cancelled the superseded submit; a plain guarded write would DROP the later
 * snapshot instead, losing the edit.)
 *
 * The answer is not shown: a refused save leaves the optimistic copy on screen, as it always did.
 */
export function usePropertyFactsSave(inspectionId: string): (facts: Record<string, unknown>) => void {
  const { submit } = useLatestWinsCommand(inspectionId);
  return useCallback(
    (facts) => {
      void submit({ type: 'save-property-facts', payload: facts });
    },
    [submit],
  );
}
