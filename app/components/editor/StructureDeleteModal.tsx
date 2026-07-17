import { Modal, Button } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

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
  const nounLabel = noun === 'section' ? m.editor_structuredelete_noun_section() : m.editor_structuredelete_noun_item();

  // For a single-item delete the "items" count is itself (always 1), so skip it.
  const impactParts: string[] = [
    ...(noun === 'section' ? [`${impact.items} ${impact.items === 1 ? m.editor_structuredelete_items_one() : m.editor_structuredelete_items_many()}`] : []),
    `${impact.ratings} ${impact.ratings === 1 ? m.editor_structuredelete_ratings_one() : m.editor_structuredelete_ratings_many()}`,
    `${impact.notes} ${impact.notes === 1 ? m.editor_structuredelete_notes_one() : m.editor_structuredelete_notes_many()}`,
    `${impact.photos} ${impact.photos === 1 ? m.editor_structuredelete_photos_one() : m.editor_structuredelete_photos_many()}`,
  ];

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={m.editor_structuredelete_title({ noun: nounLabel, title })}
      size="sm"
      footer={
        <>
          <Button
            variant="ghost"
            onClick={onCancel}
          >
            {m.common_cancel()}
          </Button>
          <Button
            variant="danger"
            onClick={onConfirm}
            data-testid="structure-delete-confirm"
          >
            {m.editor_structuredelete_confirm({ noun: nounLabel })}
          </Button>
        </>
      }
    >
      <p className="text-[13px] text-ih-fg-3">
        {m.editor_structuredelete_body({ parts: impactParts.join(' · '), noun: nounLabel })}
      </p>
    </Modal>
  );
}
