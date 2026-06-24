export interface StructureDeleteModalProps {
  open: boolean;
  /** Title of the section being deleted. */
  title: string;
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
 * NEVER window.confirm.
 */
export function StructureDeleteModal({ open, title, impact, onConfirm, onCancel }: StructureDeleteModalProps) {
  if (!open) return null;

  const impactParts: string[] = [
    `${impact.items} item${impact.items === 1 ? '' : 's'}`,
    `${impact.ratings} rating${impact.ratings === 1 ? '' : 's'}`,
    `${impact.notes} note${impact.notes === 1 ? '' : 's'}`,
    `${impact.photos} photo${impact.photos === 1 ? '' : 's'}`,
  ];

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-[rgba(15,23,42,0.6)] backdrop-blur-sm"
        onClick={onCancel}
      />
      <div className="relative bg-ih-bg-card rounded-lg shadow-ih-popover p-6 max-w-sm w-full border border-ih-border">
        <h3 className="text-[15px] font-bold text-ih-fg-1">
          Delete section &ldquo;{title}&rdquo;?
        </h3>
        <p className="text-[13px] text-ih-fg-3 mt-2">
          This removes {impactParts.join(' · ')} associated with this section. This action
          cannot be undone.
        </p>
        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-[13px] font-bold text-ih-fg-2 hover:bg-ih-bg-muted rounded-md"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-[13px] font-bold text-white bg-ih-bad hover:bg-ih-bad/85 rounded-md"
            data-testid="structure-delete-confirm"
          >
            Delete section
          </button>
        </div>
      </div>
    </div>
  );
}
