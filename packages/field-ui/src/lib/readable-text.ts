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

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const COLOR_FN = /^(?:rgba?|hsla?)\(\s*[\d.]+(?:deg|%)?(?:\s*[,/]\s*[\d.]+(?:deg|%)?|\s+[\d.]+(?:deg|%)?)*\s*\)$/i;
const TOKEN = /^var\(\s*--ih-[\w-]+\s*(?:,\s*([^;{}"'()]+(?:\([^;{}"'()]*\))?))?\s*\)$/;

/**
 * The colour string when it is a plain CSS colour that is safe to put in a style attribute, else null: a hex colour, a
 * colour name from the small table below (not any word: `foo` is not a colour), rgb()/rgba()/hsl()/hsla() with numeric
 * arguments, or a `var(--ih-...)` token whose fallback (if any) is itself one of those. The four seeded tag colours that
 * are palette names and not CSS names (`amber`, `slate`, `rose`, `emerald`) come back as their hex, because the word
 * itself is not valid CSS; the stored value stays the word. A tenant's rating colour is stored as an unvalidated string,
 * so anything else (a url(), an expression, a second declaration, quotes, braces, an unknown name) is treated as "no colour".
 */
export function safeCssColor(color: unknown): string | null {
  if (typeof color !== 'string') return null;
  const v = color.trim();
  if (v === '' || v.length > 120) return null;
  // A letters-only word (red, transparent, currentColor) carries nothing that can be injected.
  if (HEX.test(v) || COLOR_FN.test(v) || namedHex(v) !== null) return v;
  const palette = paletteHex(v);
  if (palette !== null) return palette;
  const token = TOKEN.exec(v);
  if (token) return token[1] === undefined || safeCssColor(token[1]) !== null ? v : null;
  return null;
}

/** The CSS names a tag colour can be (the picker's ten, plus the plain extremes), as hex, for the text-contrast decision only. */
const NAMED: Record<string, string> = {
  red: '#ff0000', orange: '#ffa500', yellow: '#ffff00', blue: '#0000ff', green: '#008000', teal: '#008080',
  purple: '#800080', indigo: '#4b0082', pink: '#ffc0cb', brown: '#a52a2a', gray: '#808080', grey: '#808080', white: '#ffffff', black: '#000000',
};

/** Own keys only: `constructor`, `toString`, `__proto__`... are letters-only words but not colours. */
function namedHex(name: string): string | null {
  const key = name.toLowerCase();
  return Object.hasOwn(NAMED, key) ? NAMED[key] : null;
}

/** Tailwind palette names (the 500 shade) that the seeded tags use but CSS does not know, as hex, for display only. */
const PALETTE: Record<string, string> = { amber: '#f59e0b', slate: '#64748b', rose: '#f43f5e', emerald: '#10b981' };

function paletteHex(name: string): string | null {
  const key = name.toLowerCase();
  return Object.hasOwn(PALETTE, key) ? PALETTE[key] : null;
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
  const rgb = parseHex(v) ?? parseRgb(v) ?? parseHex(namedHex(v) ?? paletteHex(v) ?? '');
  if (!rgb) return null;
  const bg = luminance(rgb);
  const onWhite = 1.05 / (bg + 0.05);
  if (onWhite >= WHITE_FLOOR) return WHITE;
  const onInk = (bg + 0.05) / (luminance(parseHex(DARK_INK)!) + 0.05);
  return onWhite >= onInk ? WHITE : DARK_INK;
}

/**
 * `color` with the two hex digits `alpha` appended, for a tint of that colour: only a 6-digit hex can take them. Any other
 * form (a name, rgb(), a 3-digit hex, a token) would become an invalid colour, so there is no tint (null).
 */
export function tintOf(color: string | null | undefined, alpha: string): string | null {
  const safe = safeCssColor(color);
  return safe !== null && /^#[0-9a-f]{6}$/i.test(safe) ? `${safe}${alpha}` : null;
}

/** The inline style of a chip that shows a data colour: the text in that colour, on a light tint of it where a tint can be made. */
export function tintedChipStyle(color: string | null | undefined): { backgroundColor?: string; color?: string } {
  return { backgroundColor: tintOf(color, '1a') ?? undefined, color: safeCssColor(color) ?? undefined };
}
