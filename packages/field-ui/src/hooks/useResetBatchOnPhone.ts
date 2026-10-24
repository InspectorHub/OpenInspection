import { useEffect } from 'react';

/**
 * Batch select is a tablet and desktop control: the phone layout has neither the toggle nor the action bar.
 * A rotation from a wider layout to the phone while batch mode is on would leave the item list in selection
 * mode (rows that select instead of open) with no way to leave it, so entering the phone layout switches it off
 * and drops the selection.
 */
export function useResetBatchOnPhone(
  isPhone: boolean,
  batchMode: boolean,
  setBatchMode: (on: boolean) => void,
  setBatchSelected: (selected: Record<string, boolean>) => void,
): void {
  useEffect(() => {
    if (!isPhone || !batchMode) return;
    setBatchMode(false);
    setBatchSelected({});
  }, [isPhone, batchMode, setBatchMode, setBatchSelected]);
}
