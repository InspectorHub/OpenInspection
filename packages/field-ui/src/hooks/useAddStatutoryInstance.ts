import { useCallback } from 'react';
import { useFieldCommand } from '../context';

export interface StatutoryInstanceAdder {
  /** Record one more instance of a repeated block, at `index`. Fire and forget. */
  add(groupId: string, index: number, fields: Record<string, unknown>): void;
  /** True while the write is out: the drawer's `saving`. */
  busy: boolean;
}

/**
 * Recording one more instance of a repeated statutory block (`add-statutory-instance`).
 *
 * Guarded rather than raw: it is a user mutation, and a second press before the first settles would write
 * the same panel twice at the same index. The answer is not shown, as before: the drawer closes on submit
 * and nothing reads a refusal.
 */
export function useAddStatutoryInstance(inspectionId: string): StatutoryInstanceAdder {
  const { run, busy } = useFieldCommand(inspectionId);
  const add = useCallback(
    (groupId: string, index: number, fields: Record<string, unknown>) => {
      void run({ type: 'add-statutory-instance', groupId, index, fields });
    },
    [run],
  );
  return { add, busy };
}
