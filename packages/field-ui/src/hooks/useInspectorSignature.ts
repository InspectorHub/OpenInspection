import { useCallback, useState } from 'react';
import { isIgnored, useFieldCommand } from '../context';

export interface InspectorSignature {
  /** Hand it the pad's data URI. Closes the dialog and applies the signature. */
  submit(dataUri: string): Promise<void>;
  /** True once the last applied signature was refused; the next answer resets it. */
  failed: boolean;
}

/**
 * Applying the inspector's own signature (the `sign-inspector` command).
 *
 * #106: it writes an e-sign record, so it goes through the guard. The pad closes the dialog on submit, so
 * there is no control left on screen to carry a pending affordance, and a refusal is reported through
 * `failed` for the dialog to show the next time it opens.
 *
 * The dialog closes only while no signature write is in flight: a submit made then sends nothing, and
 * closing anyway would say the signature had been applied. (The pad has its own same-frame guard; this
 * hook's is the one on the write.)
 */
export function useInspectorSignature(inspectionId: string, closeDialog: () => void): InspectorSignature {
  const { run, busy } = useFieldCommand(inspectionId);
  const [failed, setFailed] = useState(false);
  const submit = useCallback(
    async (dataUri: string) => {
      if (busy) return;
      closeDialog();
      const answer = await run({ type: 'sign-inspector', signatureBase64: dataUri });
      // A dropped repeat sent nothing: it is neither a success nor a failure.
      if (!isIgnored(answer)) setFailed(!answer.ok);
    },
    [run, busy, closeDialog],
  );
  return { submit, failed };
}
