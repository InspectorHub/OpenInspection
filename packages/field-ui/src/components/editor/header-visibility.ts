/**
 * Editor-header visibility table — the single source for which COMPOSE-tier
 * control lives in the header row and which lives in the "More" overflow, at
 * every width.
 *
 * The header and the overflow menu are two lists that must be exact
 * complements: a control visible in both is duplicated, and a control in
 * neither is unreachable — which is precisely how Preview came to be
 * `2xl`-gated while Publish stayed always-on, leaving the whole 768-1279px
 * band (iPad landscape included) able to publish a report it could not look
 * at first.
 *
 * Rather than restate the pairing in a comment on each side, both sides import
 * these strings, so drift is not something anyone has to remember. `inline` is
 * the header button's class; `row` is the overflow row's. `header-visibility`
 * asserts they stay inverses.
 *
 * Tailwind scans .ts sources, so these literals are picked up for generation.
 */
export const HEADER_OVERFLOW = {
  /** Manual signature — the Sign modal. */
  sign: { inline: 'hidden min-[1400px]:inline-flex', row: 'min-[1400px]:hidden' },
  /** Advisory order-lifecycle move; the publish modal offers it too. */
  finishFieldwork: { inline: 'hidden 2xl:inline-flex', row: '2xl:hidden' },
  /** #181 — collab-only version history. */
  versionHistory: { inline: 'hidden xl:flex', row: 'xl:hidden' },
  /** auto / light / dark / field theme control. */
  theme: { inline: 'hidden min-[2100px]:flex', row: 'min-[2100px]:hidden' },
} as const;

/**
 * The breakpoint a class pair pivots on, or null when the pair is malformed
 * (no breakpoint, or the two sides name different ones). Exported for the
 * conformance test rather than inlined there, so the parse rule and the table
 * ship together.
 */
export function pivotBreakpoint(pair: { inline: string; row: string }): string | null {
  const inlineBp = /(?:^|\s)(sm|md|lg|xl|2xl|min-\[\d+px\]):(?:inline-flex|flex|block|inline)(?:\s|$)/.exec(pair.inline)?.[1];
  const rowBp = /(?:^|\s)(sm|md|lg|xl|2xl|min-\[\d+px\]):hidden(?:\s|$)/.exec(pair.row)?.[1];
  if (!inlineBp || !rowBp || inlineBp !== rowBp) return null;
  // The header button must also START hidden, or it shows at every width and
  // the overflow row duplicates it below the breakpoint.
  if (!/(?:^|\s)hidden(?:\s|$)/.test(pair.inline)) return null;
  return inlineBp;
}

const TAILWIND_PX: Record<string, number> = { sm: 640, md: 768, lg: 1024, xl: 1280, '2xl': 1536 };

/** The width, in px, a pivot breakpoint starts at (`xl` or `min-[1400px]`). */
function pivotPx(bp: string): number {
  return TAILWIND_PX[bp] ?? Number(/min-\[(\d+)px\]/.exec(bp)?.[1] ?? 0);
}

/**
 * The class that hides the More trigger where it would be empty, or null when no row is present at all. A row can be
 * absent (no theme slot, fieldwork already finished, no collaboration, read-only), and the trigger is needed only
 * until the widest pivot among the rows that ARE present, because from there every one of them is inline again.
 */
export function overflowTriggerHide(present: ReadonlyArray<keyof typeof HEADER_OVERFLOW>): string | null {
  let widest: { px: number; cls: string } | null = null;
  for (const key of present) {
    const pair = HEADER_OVERFLOW[key];
    const px = pivotPx(pivotBreakpoint(pair) ?? '');
    if (widest === null || px > widest.px) widest = { px, cls: pair.row };
  }
  return widest?.cls ?? null;
}
