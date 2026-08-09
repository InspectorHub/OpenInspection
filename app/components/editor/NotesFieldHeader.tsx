import { Button } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

/** Past this the meter turns bad-toned; the note is not blocked, only flagged. */
const NOTES_SOFT_LIMIT = 2000;

export interface NotesFieldHeaderProps {
  /** `id` of the textarea this header labels and describes. */
  fieldId: string;
  /** Live length of the note, rendered as the character meter. */
  charCount: number;
  /** Whether this item has canned comments worth offering at all. */
  canInsertCanned: boolean;
  /** True while the suggestion listbox under the field is showing. */
  suggestionsOpen: boolean;
  /** Open that list and put the caret back in the note. */
  onOpenSuggestions: () => void;
}

/**
 * The Notes field's own toolbar: field name, the control that puts library text
 * INTO the field, and the character meter.
 *
 * "Recommended comments" belongs ABOVE the textarea and never inside it (#73).
 * It used to be `absolute right-2 top-2`, floating over the top-right corner of
 * the box — and a textarea cannot indent only its first line, so the moment
 * line one reached the right edge the control sat on top of the inspector's own
 * words. That was occasional until AI "Improve wording" started returning full
 * paragraphs; then it was every note. No CSS fixes it, because the collision is
 * in the information architecture: a control that inserts text was being
 * rendered as an ornament on the text.
 *
 * Below the field was not free either — that space belongs to `AiAssistPanel`,
 * whose draft slab needs the full width to be read against the note above it.
 * Above is also the honest read: this affordance acts on the field, so it sits
 * at the same rank as the field's own label.
 *
 * Placement is pinned structurally by `item-editor-notes-toolbar.test.tsx`,
 * because one box covering another is invisible to type-check, eslint and
 * `lint:ds` alike — only a browser can see it, and only with a long enough
 * first line.
 */
export function NotesFieldHeader({
  fieldId,
  charCount,
  canInsertCanned,
  suggestionsOpen,
  onOpenSuggestions,
}: NotesFieldHeaderProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1">
      <label htmlFor={fieldId} className="text-[11px] font-bold uppercase tracking-wide text-ih-fg-4">
        {m.editor_item_notes_label()}
      </label>
      {canInsertCanned && (
        // Same vocabulary as the editor's other dropdown triggers
        // (see CloneLastButton): secondary/sm plus a caret glyph.
        <Button
          variant="secondary"
          size="sm"
          data-testid="notes-recommended-trigger"
          aria-haspopup="listbox"
          aria-expanded={suggestionsOpen}
          onClick={onOpenSuggestions}
        >
          {m.editor_item_recommended()}
          <span className="text-[10px]" aria-hidden="true">▾</span>
        </Button>
      )}
      <span
        className={`ml-auto text-[10px] font-mono tabular-nums ${
          charCount > NOTES_SOFT_LIMIT ? "text-ih-bad-fg" : "text-ih-fg-4"
        }`}
      >
        {m.editor_item_notes_chars({ count: charCount })}
      </span>
    </div>
  );
}
