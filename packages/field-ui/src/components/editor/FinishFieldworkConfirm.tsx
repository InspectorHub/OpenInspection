import { useCallback, useState, type ReactNode } from "react";
import { useActionLatch } from "@core/shared-ui";
import { ConfirmDialog } from "../ConfirmDialog";
import { m } from "../../i18n";

/**
 * "Finish fieldwork?" in front of the lifecycle move that every entry point (desktop button, More menu, phone drawer)
 * shares. `request` opens the dialog; confirming runs `finish` and the dialog closes when that settles, whether it was
 * accepted or refused (a refusal is reported by the caller). The latch takes the decision before anything is sent, so two
 * presses in one frame send one command.
 */
export function useFinishFieldworkConfirm(finish: () => Promise<void>, busy: boolean): { request: () => void; dialog: ReactNode } {
  const [open, setOpen] = useState(false);
  const latch = useActionLatch(busy);
  const request = useCallback(() => setOpen(true), []);
  const dialog = (
    <ConfirmDialog
      open={open}
      title={m.editor_finish_fieldwork_confirm_title()}
      message={m.editor_finish_fieldwork_confirm_body()}
      confirmLabel={m.editor_finish_fieldwork()}
      tone="default"
      busy={busy}
      onConfirm={() => latch(() => void finish().catch(() => undefined).finally(() => setOpen(false)))}
      onCancel={() => setOpen(false)}
    />
  );
  return { request, dialog };
}
