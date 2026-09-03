import { useRef, useState } from "react";
import { Modal, Button, Input } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

export interface InviteLinkTarget {
  /** The accept URL exactly as the SERVER built it — never composed here. */
  url: string;
  /** Who the invitation was created for; named in the copy so it can't be misdelivered. */
  email: string;
}

/**
 * The accept link for one pending invitation, shown so a person can hand it
 * over themselves.
 *
 * It SHOWS the URL rather than only copying it. `navigator.clipboard.writeText`
 * rejects on an insecure origin or a browser policy, and in a background tab
 * Chrome leaves the promise PENDING rather than rejecting — so a copy-only
 * control answers a click with no feedback of any kind, which is what the first
 * version of this did when it was tried. A URL on screen can always be read and
 * selected by hand, so that is the floor; copying is the convenience on top,
 * and its failure costs nothing.
 *
 * The link is a CREDENTIAL: the token in it is the invite's primary key, so
 * whoever holds the URL can take that seat. The body copy says so, because the
 * whole point of this dialog is that someone is about to paste it into a
 * channel of their own choosing.
 */
export function InviteLinkModal({ target, onClose }: { target: InviteLinkTarget | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Leave the label alone rather than claim a copy that did not happen.
      // The URL is on screen either way, so this is a lost convenience, not a
      // lost capability.
    }
  }

  return (
    <Modal
      open={target !== null}
      onClose={onClose}
      title={m.settings_team_invite_link_title()}
      size="lg"
      initialFocusRef={inputRef}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {m.common_close()}
          </Button>
          <Button variant="primary" onClick={() => { if (target) void copy(target.url); }}>
            {copied ? m.settings_team_invite_link_copied() : m.settings_team_copy_invite_link()}
          </Button>
        </>
      }
    >
      <p className="text-[13px] text-ih-fg-2 mb-3">
        {target ? m.settings_team_invite_link_help({ email: target.email }) : ""}
      </p>
      <Input
        ref={inputRef}
        readOnly
        value={target?.url ?? ""}
        onFocus={(e) => e.currentTarget.select()}
        aria-label={m.settings_team_invite_link_title()}
      />
    </Modal>
  );
}
