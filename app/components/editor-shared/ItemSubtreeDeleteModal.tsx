/**
 * "This will take N rows you cannot see with it."
 *
 * Deleting an item takes its whole subtree. On a flat list that is one row and
 * the confirmation would be noise, so this only opens when something INVISIBLE
 * would go too — the count is the whole message.
 *
 * A modal rather than `window.confirm`: the house rule, and the reason for it
 * is that a native confirm cannot say the label and the count in the tenant's
 * own language.
 */
import { Button, Modal } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

export interface PendingSubtreeDelete {
  id: string;
  label: string;
  /** Descendants that go with it. Never 0 — at 0 the caller deletes outright. */
  count: number;
}

export interface ItemSubtreeDeleteModalProps {
  pending: PendingSubtreeDelete | null;
  onCancel: () => void;
  onConfirm: (itemId: string) => void;
}

export function ItemSubtreeDeleteModal({ pending, onCancel, onConfirm }: ItemSubtreeDeleteModalProps) {
  if (!pending) return null;
  return (
    <Modal
      open
      onClose={onCancel}
      title={m.common_delete()}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>{m.common_cancel()}</Button>
          <Button variant="danger" onClick={() => onConfirm(pending.id)}>
            {m.editor_shared_delete_with_children_confirm()}
          </Button>
        </>
      }
    >
      <p className="text-[13px] text-ih-fg-2">
        {m.editor_shared_delete_with_children({ label: pending.label, count: pending.count })}
      </p>
    </Modal>
  );
}
