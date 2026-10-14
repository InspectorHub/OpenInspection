import { useState } from "react";
import { Button, Card, useActionLatch } from "@core/shared-ui";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import { m } from "~/paraglide/messages";

/** Where this contact stands with QuickBooks, as the card draws it. */
export interface ContactQboLink {
  linked: boolean;
  qboCustomerId: string | null;
  /** The customer's name as it was when the match was made; null when it was not recorded. */
  displayName: string | null;
  /** Items that need attention for this contact. */
  openErrorCount: number;
}

/**
 * The QuickBooks card on a contact's page: not matched yet, matched, and how many
 * items need attention. It draws nothing when QuickBooks is not connected.
 *
 * Removing a match asks first, and says what happens next: nothing changes in
 * QuickBooks, and the next sync looks for a customer with the same email before
 * it creates one. An archived contact keeps its match, so Remove stays available
 * there; matching is refused for an archived contact, so no match button is offered.
 */
export function ContactQboCard({
  connected,
  link,
  archived = false,
  onOpenDialog,
  onUnlink,
  unlinking,
  unlinkFailed = false,
}: {
  connected: boolean;
  link: ContactQboLink;
  archived?: boolean;
  onOpenDialog: () => void;
  onUnlink: () => void;
  unlinking: boolean;
  unlinkFailed?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  // The dialog stays mounted for the frame in which the first click closes it,
  // so a second click in that frame would confirm again.
  const latch = useActionLatch(unlinking);


  if (!connected) return null;

  const attention =
    link.openErrorCount === 1
      ? m.contact_qbo_attention_one()
      : link.openErrorCount > 1
        ? m.contact_qbo_attention_many({ count: link.openErrorCount })
        : null;

  return (
    <Card className="p-5">
      <div className="mb-3">
        <h2 className="text-[13px] font-extrabold uppercase tracking-[0.15em] text-ih-fg-3">
          {m.contact_qbo_heading()}
        </h2>
      </div>

      <div className="space-y-3 text-[13px]">
        {link.linked ? (
          <div>
            <p className="font-bold text-ih-fg-1">
              {link.displayName
                ? m.contact_qbo_matched({ customer: link.displayName })
                : m.contact_qbo_matched_unnamed()}
            </p>
            {!link.displayName && link.qboCustomerId && (
              <p className="text-ih-fg-3">{m.contact_qbo_matched_id({ suffix: link.qboCustomerId.slice(-4) })}</p>
            )}
          </div>
        ) : (
          <div>
            <p className="font-bold text-ih-fg-1">{m.contact_qbo_not_matched()}</p>
            <p className="text-ih-fg-3">{m.contact_qbo_not_matched_desc()}</p>
          </div>
        )}

        {attention && (
          <p className="rounded-md bg-ih-watch-bg px-3 py-2.5 text-ih-watch-fg">{attention}</p>
        )}

        {archived && !link.linked && <p className="text-ih-fg-3">{m.contact_qbo_archived_note()}</p>}

        {unlinkFailed && (
          <p role="alert" className="rounded-md bg-ih-bad-bg px-3 py-2.5 text-ih-bad-fg">
            {m.contact_qbo_remove_failed()}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {!archived && (
            <Button variant={link.linked ? "secondary" : "primary"} onClick={onOpenDialog}>
              {link.linked ? m.contact_qbo_change_button() : m.contact_qbo_match_button()}
            </Button>
          )}
          {link.linked && (
            <Button variant="secondary" pending={unlinking} onClick={() => setConfirming(true)}>
              {m.contact_qbo_remove_button()}
            </Button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirming}
        title={m.contact_qbo_remove_title()}
        message={m.contact_qbo_remove_body()}
        confirmLabel={m.contact_qbo_remove_confirm()}
        cancelLabel={m.contact_qbo_remove_keep()}
        busy={unlinking}
        onConfirm={() => latch(() => { setConfirming(false); onUnlink(); })}
        onCancel={() => setConfirming(false)}
      />
    </Card>
  );
}
