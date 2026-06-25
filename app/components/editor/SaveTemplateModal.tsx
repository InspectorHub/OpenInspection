export interface SaveTemplateModalProps {
  /** Non-null while open: 'back' updates the source template, 'new' forks a copy. */
  mode: "back" | "new" | null;
  /** Name input value (only used in 'new' mode). */
  name: string;
  onChangeName: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * D8 — "Save structure to template" modal. Two modes:
 *  - 'back': overwrite the inspection's SOURCE template with the current
 *    structure (warns that future inspections pick it up; published reports
 *    keep their frozen snapshot).
 *  - 'new': fork the current structure into a brand-new template (needs a name).
 * Custom modal — NEVER window.confirm / window.prompt.
 */
export function SaveTemplateModal({ mode, name, onChangeName, onConfirm, onCancel }: SaveTemplateModalProps) {
  if (!mode) return null;
  const isNew = mode === "new";

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[rgba(15,23,42,0.6)] backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-ih-bg-card rounded-lg shadow-ih-popover p-6 max-w-sm w-full border border-ih-border">
        <h3 className="text-[15px] font-bold text-ih-fg-1">
          {isNew ? "Save as new template" : "Save structure to template"}
        </h3>
        <p className="text-[13px] text-ih-fg-3 mt-2">
          {isNew
            ? "Creates a new template from this inspection's current structure. It becomes available for future inspections; this inspection is unchanged."
            : "Overwrites the source template with this inspection's current structure. Future inspections created from it pick up the change; already-published reports keep their frozen snapshot."}
        </p>
        {isNew && (
          <label className="block mt-4 text-[12px] font-bold text-ih-fg-2">
            Template name
            <input
              type="text"
              value={name}
              onChange={(e) => onChangeName(e.target.value)}
              autoFocus
              placeholder="Custom Template"
              className="mt-1 w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-app text-[13px] font-normal"
              onKeyDown={(e) => { if (e.key === "Enter") onConfirm(); }}
              data-testid="save-template-name"
            />
          </label>
        )}
        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-[13px] font-bold text-ih-fg-2 hover:bg-ih-bg-muted rounded-md"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-[13px] font-bold text-white bg-ih-primary hover:bg-ih-primary/85 rounded-md"
            data-testid="save-template-confirm"
          >
            {isNew ? "Create template" : "Save to template"}
          </button>
        </div>
      </div>
    </div>
  );
}
