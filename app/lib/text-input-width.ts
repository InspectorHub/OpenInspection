/**
 * How wide a bare text input should ask to be, in characters.
 *
 * This exists because of one defect (F38): the template editor's name input was
 * a fixed `w-48` — 192px — holding a name that needed 223px. It rendered
 * "Standard Residential Inspection" as "Standard Residential Inspec", with
 * `text-overflow: clip`, so nothing on screen said a third of the name was
 * missing, and ~600px of the toolbar beside it was empty.
 *
 * A fixed width can only be right for one string length. `size` is the
 * browser's own "be as wide as this much content" control, so the width follows
 * what is in the field — which is the requirement the fixed width was standing
 * in for: somebody renaming a thing can read the name they are renaming.
 *
 * Pure, and separate from the component, so the property that matters can be
 * asserted without a layout engine: the whole value is accounted for up to the
 * cap, never less than the floor. The caller still needs `min-w-0` so the input
 * can give the width back when its row is genuinely short of room — `size` is
 * a preferred width, not a minimum.
 */

/** Floor: an empty name still has to be a visible, clickable target. */
export const TEXT_INPUT_MIN_CHARS = 16;
/** Cap: a very long name must not push the rest of a toolbar around. */
export const TEXT_INPUT_MAX_CHARS = 48;

export function textInputSize(
  value: string,
  min: number = TEXT_INPUT_MIN_CHARS,
  max: number = TEXT_INPUT_MAX_CHARS,
): number {
  return Math.min(Math.max(value.length, min), max);
}
