/**
 * The leading column of an item row: indentation, a guide rail, and the
 * outline number.
 *
 * -- WHY THE WIDTH IS AN INLINE STYLE AND NOT A PADDING UTILITY -------------
 * The row's className is a concatenated template literal, not a
 * tailwind-merged one, and it already sets padding. Adding `pl-6` beside an
 * existing `px-3` leaves two utilities of identical specificity whose winner is
 * decided by generated-stylesheet order, not by element order -- a rule that is
 * correct until something unrelated reorders it, with `lint:ds` green the whole
 * time and only a computed style in Chrome able to see it. An inline width
 * cannot collide with a class, because it is not one.
 *
 * -- WHY inlineSize / border-inline-start -----------------------------------
 * Logical properties, so a right-to-left locale indents from the right without
 * a second code path.
 *
 * -- WHY A NUMBER AND NOT JUST INDENTATION ----------------------------------
 * The item column is 280px and labels are truncated. An outline number is
 * still legible after truncation; an indent read at a glance is not, once a
 * row scrolls away from its parent.
 */
const STEP_PX = 14;

export interface ItemRowIndentProps {
  /** 0 = top level. */
  depth: number;
  /** `A`, `A.1`, `A.1.a` — derived from the tree, never stored. */
  outline: string;
}

export function ItemRowIndent({ depth, outline }: ItemRowIndentProps) {
  return (
    <>
      <span
        data-indent-spacer
        {...(depth > 0 ? { "data-guide": "true" } : {})}
        aria-hidden="true"
        className={depth > 0 ? "shrink-0 self-stretch border-ih-border" : "shrink-0"}
        style={{
          inlineSize: depth * STEP_PX,
          ...(depth > 0
            ? { borderInlineStartWidth: 1, borderInlineStartStyle: "solid" }
            : {}),
        }}
      />
      <span className="text-[10px] text-ih-fg-3 font-mono shrink-0 min-w-[2.25rem]">
        {outline}
      </span>
    </>
  );
}
