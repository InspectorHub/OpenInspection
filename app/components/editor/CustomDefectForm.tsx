import type { CustomDefectCategory } from "../../lib/custom-defects";

export interface CustomDefectFormProps {
  title: string;
  comment: string;
  category: CustomDefectCategory;
  saveToLibrary: boolean;
  /** When set, renders the "Save to my library" checkbox (Track H B-20 回流). */
  showSaveToLibrary: boolean;
  onTitleChange: (value: string) => void;
  onCommentChange: (value: string) => void;
  onCategoryChange: (value: CustomDefectCategory) => void;
  onSaveToLibraryChange: (value: boolean) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

/* B-20 — inline add form for a field-authored custom defect. */
export function CustomDefectForm({
  title,
  comment,
  category,
  saveToLibrary,
  showSaveToLibrary,
  onTitleChange,
  onCommentChange,
  onCategoryChange,
  onSaveToLibraryChange,
  onCancel,
  onSubmit,
}: CustomDefectFormProps) {
  return (
    <div className="p-2.5 rounded-lg border border-dashed border-ih-border-strong space-y-2">
      <input
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        placeholder="Defect title — e.g. Water stain at sheathing"
        aria-label="Custom defect title"
        autoFocus
        className="w-full h-9 px-3 rounded-lg border border-ih-border bg-ih-bg-card text-[13px] focus:shadow-ih-focus focus:border-ih-primary outline-none"
      />
      <textarea
        value={comment}
        onChange={(e) => onCommentChange(e.target.value)}
        placeholder="Narrative for the report (optional)"
        aria-label="Custom defect narrative"
        className="w-full h-16 px-3 py-2 rounded-lg border border-ih-border bg-ih-bg-card text-[13px] resize-none focus:shadow-ih-focus focus:border-ih-primary outline-none"
      />
      <div className="flex items-center gap-2">
        <select
          value={category}
          onChange={(e) => onCategoryChange(e.target.value as CustomDefectCategory)}
          aria-label="Custom defect category"
          className="h-8 px-2 rounded-lg border border-ih-border bg-ih-bg-card text-[12px] outline-none"
        >
          <option value="safety">Safety</option>
          <option value="recommendation">Recommendation</option>
          <option value="maintenance">Maintenance</option>
        </select>
        {/* Track H (B-20 回流) — default OFF so one-off findings don't pollute the library */}
        {showSaveToLibrary && (
          <label className="flex items-center gap-1.5 text-[11px] text-ih-fg-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={saveToLibrary}
              onChange={(e) => onSaveToLibraryChange(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-ih-border-strong text-ih-primary focus:ring-ih-primary/30"
            />
            Save to my library
          </label>
        )}
        <span className="flex-1" />
        <button
          type="button"
          onClick={onCancel}
          className="h-8 px-3 rounded-lg text-[12px] font-medium text-ih-fg-3 hover:bg-ih-bg-muted"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={!title.trim()}
          className="h-8 px-3 rounded-lg bg-ih-primary text-white text-[12px] font-bold hover:bg-ih-primary-600 disabled:opacity-40"
        >
          Add defect
        </button>
      </div>
    </div>
  );
}
