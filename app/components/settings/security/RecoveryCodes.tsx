import { Modal, Button } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

/**
 * The recovery codes, shown the one time they exist outside the server.
 *
 * A dialog rather than a line of text under the toggle, and closable only by
 * an explicit acknowledgement, because these cannot be retrieved: the server
 * stores hashes. Somebody who scrolls past them and later loses their phone
 * has lost the account, and no amount of support can undo it — so the screen
 * has to be in the way.
 *
 * There is no "copy" here on purpose. A copy button reports success it cannot
 * verify (the clipboard can refuse silently), and these are the credentials
 * where believing you have them and not having them is the whole failure.
 * Download writes a file the browser confirms; the codes are also on screen to
 * be written down.
 */
export function RecoveryCodes({
  open,
  codes,
  onClose,
}: {
  open: boolean;
  codes: string[];
  onClose: () => void;
}) {
  function download() {
    const blob = new Blob([codes.join("\n") + "\n"], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "inspection-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Modal
      open={open && codes.length > 0}
      onClose={onClose}
      title={m.settings_2fa_recovery_title()}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={download}>{m.settings_2fa_recovery_download()}</Button>
          <Button variant="primary" onClick={onClose}>{m.settings_2fa_done()}</Button>
        </>
      }
    >
      <p className="text-[13px] text-ih-bad-fg font-medium mb-3">{m.settings_2fa_recovery_warning()}</p>
      <ul className="grid grid-cols-2 gap-2 font-mono text-[13px] text-ih-fg-1">
        {codes.map((c) => (
          <li key={c} className="px-3 py-2 rounded-md bg-ih-bg-muted border border-ih-border tracking-wider">
            {c}
          </li>
        ))}
      </ul>
    </Modal>
  );
}
