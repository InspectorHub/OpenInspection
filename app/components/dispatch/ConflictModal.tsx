import { Button, Modal } from "@core/shared-ui";
import { m } from "~/paraglide/messages";
import type { ScheduleConflict } from "./dispatch-helpers";

/**
 * What a refused drop is allowed to say.
 *
 * The tenant's `booking_conflict_policy` is `block`, so the server already
 * declined the write — this window reports a decision, it does not ask for
 * one. There is deliberately no "do it anyway": an override here would make
 * the setting a suggestion, and the same drag would then mean different things
 * depending on which surface performed it.
 *
 * It names the colliding jobs because "that slot is taken" without saying BY
 * WHAT sends the dispatcher hunting through the board they were already
 * looking at.
 */
export function ConflictModal({
  open,
  conflicts,
  onClose,
}: {
  open: boolean;
  conflicts: ScheduleConflict[];
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={m.dispatch_conflict_title()}
      footer={<Button variant="primary" onClick={onClose}>{m.dispatch_conflict_close()}</Button>}
    >
      <p className="text-[13px] text-ih-fg-2">{m.dispatch_conflict_body()}</p>
      <ul className="mt-3 space-y-2">
        {conflicts.map((conflict) => (
          <li
            key={`${conflict.inspectionId}-${conflict.inspectorId}`}
            className="rounded-lg border border-ih-border bg-ih-bg-muted px-3 py-2 text-[12px] text-ih-fg-2"
          >
            <span className="font-bold">{conflict.propertyAddress}</span>
            <span className="ml-2 text-ih-fg-3">{conflict.date}</span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
