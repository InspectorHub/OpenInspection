import { Modal, Button } from "@core/shared-ui";

export interface StructureDeleteModalProps {
  open: boolean;
  /** Title of the section/item being deleted. */
  title: string;
  /** What is being deleted — drives the heading + button copy. Default 'section'. */
  noun?: "section" | "item";
  /** Count of findings data that will be lost. */
  impact: {
    items: number;
    ratings: number;
    notes: number;
    photos: number;
  };
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirmation modal for structural section deletion (D8).
 *
 * Shows the section title + a summary of findings data that will be removed
 * (items, ratings, notes, photos). The inspector must explicitly confirm —
 * NEVER window.confirm. Rides the shared Modal primitive; Modal owns the
 * generic Esc/backdrop close (maps to onCancel).
 */
export function StructureDeleteModal({ open, title, noun = 'section', impact, onConfirm, onCancel }: StructureDeleteModalProps) {
  // For a single-item delete the "items" count is itself (always 1), so skip it.
  const impactParts: string[] = [
    ...(noun === 'section' ? [`${impact.items} item${impact.items === 1 ? '' : 's'}`] : []),
    `${impact.ratings} rating${impact.ratings === 1 ? '' : 's'}`,
    `${impact.notes} note${impact.notes === 1 ? '' : 's'}`,
    `${impact.photos} photo${impact.photos === 1 ? '' : 's'}`,
  ];

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={`Delete ${noun} “${title}”?`}
      size="sm"
      footer={
        <>
          <Button
            variant="ghost"
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={onConfirm}
            data-testid="structure-delete-confirm"
          >
            Delete {noun}
          </Button>
        </>
      }
    >
      <p className="text-[13px] text-ih-fg-3">
        This removes {impactParts.join(' · ')} associated with this {noun}. This action
        cannot be undone.
      </p>
    </Modal>
  );
}
