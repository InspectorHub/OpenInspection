import { FALLBACK_RATING_COLOR } from './severity';

export { FALLBACK_RATING_COLOR };

/** The dark ink used on a light fill (the foreground colour of the light theme). */
const DARK_INK = '#0f172a';
const WHITE = '#ffffff';

/** True for that fallback. It is filled with token classes (a muted surface and its foreground), which are right in every theme. */
export function isFallbackRatingColor(color: string | null | undefined): boolean {
  return color === FALLBACK_RATING_COLOR;
}

function parseHex(v: string): [number, number, number] | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v)?.[1];
  if (!hex) return null;
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

function parseRgb(v: string): [number, number, number] | null {
  const m = /^rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)(?:[\s,/]+[\d.]+%?)?\s*\)$/i.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** White keeps the default as long as it reads at least this well on the fill (the large-text floor of WCAG). */
const WHITE_FLOOR = 3;

/**
 * The text colour for a fill whose colour is data (a tenant's rating colour, a tag colour) rather than a design token.
 * White stays the colour unless it would read below 3:1 on the fill; then it is whichever of white and dark ink reads
 * better, so the saturated reds and blues keep their white while greens, ambers and pale fills get dark ink. Null when
 * the colour is not a plain hex or rgb()/rgba() value (a name, a `var()` token): the caller then keeps the text colour
 * it already had, which a theme-aware token handles in both themes.
 */
export function readableTextOn(background: string | null | undefined): string | null {
  if (!background) return null;
  const v = background.trim();
  const rgb = parseHex(v) ?? parseRgb(v);
  if (!rgb) return null;
  const bg = luminance(rgb);
  const onWhite = 1.05 / (bg + 0.05);
  if (onWhite >= WHITE_FLOOR) return WHITE;
  const onInk = (bg + 0.05) / (luminance(parseHex(DARK_INK)!) + 0.05);
  return onWhite >= onInk ? WHITE : DARK_INK;
}
