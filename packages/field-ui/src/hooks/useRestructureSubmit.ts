import { useCallback } from 'react';
import type { CommandData, FieldCommand } from '../commands';
import { isIgnored, useFieldDataSource } from '../context';
import type { FieldRunResult } from '../context';
import { m } from '../i18n';
import { useLatestWinsCommand } from './useLatestWinsCommand';

/**
 * The structure editor's write channel: newest-wins (see `useLatestWinsCommand`), and a refused write is
 * reported to the user. The host's own sentence is shown when it sent one (for example "Structure saved, but
 * live sync did not converge"), else a generic one. A request a newer edit superseded reports nothing: the
 * newer one answers for the document.
 */
export function useRestructureSubmit(inspectionId: string) {
  const { submit } = useLatestWinsCommand(inspectionId);
  const { notify } = useFieldDataSource();
  return useCallback(
    async <C extends FieldCommand>(cmd: C): Promise<FieldRunResult<CommandData<C>>> => {
      const result = await submit(cmd);
      if (!isIgnored(result) && !result.ok) notify(result.error || m.editor_structure_save_failed(), 'error');
      return result;
    },
    [submit, notify],
  );
}
