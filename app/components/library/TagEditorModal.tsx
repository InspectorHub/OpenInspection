import { Modal, Button, Input, Select } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

/**
 * The colours a tag may carry.
 *
 * The server validates `color` as `/^[a-z]{3,20}$/` and the list renders it
 * straight into `backgroundColor`, so the constraint and the rendering
 * disagree: `zzz` passes validation and paints nothing. A fixed list is the
 * only shape where every accepted value is also a visible one — these are CSS
 * colour keywords, and the first four are what the starter tags already use.
 */
export const TAG_COLORS = [
  "red", "orange", "yellow", "blue", "green", "teal", "purple", "pink", "brown", "gray",
] as const;

/**
 * The list plus whatever this tag already carries.
 *
 * Existing data holds tokens this list does not: `rose`, `emerald` and `amber`
 * are Tailwind palette names, not CSS colour keywords, so they pass the
 * server's `/^[a-z]{3,20}$/` and paint NOTHING in the list — visible on
 * `/library/tags`, where three of nine starter tags show no swatch.
 *
 * They are kept as options anyway. A select that cannot represent the current
 * value shows "No color" for a tag that has one, and saving then changes the
 * colour as a side effect of opening the dialog — the quiet kind of edit
 * nobody asked for.
 */
export function colorOptionsFor(current?: string | null): readonly string[] {
  if (!current || (TAG_COLORS as readonly string[]).includes(current)) return TAG_COLORS;
  return [current, ...TAG_COLORS];
}

export interface EditableTag {
  id: string;
  name: string;
  color?: string | null;
  /** Starter tags: recolourable, but NOT renameable — the server refuses it. */
  isSeed?: boolean;
}

/**
 * Create or rename a tag.
 *
 * `POST /api/tags` and `PUT /api/tags/{id}` have existed since they were
 * written; the page called neither, so "+ Add tag" and every row's "Edit" were
 * `<button>` elements with no `onClick`.
 *
 * Two asymmetries this form has to carry, both of them server rules that a
 * plausible-looking implementation would get wrong:
 *
 *  - CREATE allows an inspector; UPDATE is owner/manager only. An Edit control
 *    shown to an inspector is a button whose only outcome is 403.
 *  - a STARTER tag can be recoloured but not renamed
 *    (`tag.service.ts`: "Seed tags cannot be renamed"), because inspections
 *    already reference it by name. So the name field is disabled for those
 *    rather than the whole dialog.
 */
export function TagEditorModal({
  tag,
  open,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  /** `null` means "create"; a tag means "edit that one". */
  tag: EditableTag | null;
  open: boolean;
  busy: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (form: HTMLFormElement) => void;
}) {
  const isEdit = tag !== null;
  const nameLocked = isEdit && !!tag.isSeed;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? m.library_tags_edit_title() : m.library_tags_new_title()}
      size="md"
    >
      <form
        onSubmit={(e) => { e.preventDefault(); onSubmit(e.currentTarget); }}
        className="space-y-4"
      >
        {/* Keyed so switching rows re-mounts the fields with the new tag's
            values — a controlled form would need the same, and an uncontrolled
            one silently keeps the previous row's text without it. */}
        <Input
          key={`${tag?.id ?? "new"}-name`}
          name="name"
          autoFocus={!nameLocked}
          defaultValue={tag?.name ?? ""}
          readOnly={nameLocked}
          label={m.library_tags_name_label()}
          error={error}
          reserveErrorSpace
        />
        {nameLocked && (
          <p className="text-[12px] text-ih-fg-3 -mt-2">{m.library_tags_seed_name_locked()}</p>
        )}

        <Select
          key={`${tag?.id ?? "new"}-color`}
          name="color"
          defaultValue={tag?.color ?? ""}
          label={m.library_tags_color_label()}
        >
          <option value="">{m.library_tags_color_none()}</option>
          {colorOptionsFor(tag?.color).map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </Select>

        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose}>
            {m.library_tags_cancel()}
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? m.library_tags_saving() : m.library_tags_save()}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
