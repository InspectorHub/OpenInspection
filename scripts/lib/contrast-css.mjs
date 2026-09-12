/**
 * Stylesheet reading and WCAG colour maths for `scripts/check-contrast.mjs`.
 *
 * Everything here answers "what colour is this token, in this theme, actually
 * worth". It knows nothing about JSX, class strings or which surface a piece of
 * text sits on — that is `contrast-scan.mjs` and the gate.
 */

/** WCAG 2.1 AA, normal-size text. */
export const AA_NORMAL = 4.5;

/**
 * Theme blocks in cascade order: `field` is declared inside the dark group and
 * overrides part of it, and both fall through to `:root`. Matching on the
 * SELECTOR LIST (not an exact selector) matters — dark is declared as a group
 * `html[...="dark"], html[...="field"], .dark { … }`, so searching for the
 * exact dark selector finds nothing and silently reads the light palette. A
 * sibling spec once did exactly that and "passed" its dark assertions against
 * the light values.
 */
export const THEMES = [
  { name: "light", marker: ":root" },
  { name: "dark", marker: 'data-color-scheme="dark"' },
  { name: "field", marker: 'data-color-scheme="field"' },
];

/** #rgb / #rrggbb -> [r,g,b] 0-255. Returns null for anything else. */
export function parseHex(value) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(value).trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

/** WCAG relative luminance. */
export function luminance([r, g, b]) {
  const lin = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** WCAG contrast ratio between two hex colours, or null if either is not hex. */
export function contrastRatio(fgHex, bgHex) {
  const fg = parseHex(fgHex);
  const bg = parseHex(bgHex);
  if (!fg || !bg) return null;
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Every declaration body whose selector list mentions `marker`, in order. */
function blocksFor(css, marker) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css)) !== null) if (m[1].includes(marker)) out.push(m[2]);
  return out;
}

/** A custom property's effective value in theme `i`, following the cascade. */
export function resolveVar(css, themeIndex, prop) {
  for (let i = themeIndex; i >= 0; i--) {
    const blocks = blocksFor(css, THEMES[i].marker);
    for (let b = blocks.length - 1; b >= 0; b--) {
      const hit = blocks[b].match(new RegExp(`${prop}\\s*:\\s*([^;]+);`));
      if (hit) return hit[1].trim();
    }
  }
  return null;
}

/**
 * `text-ih-<suffix>` / `bg-ih-<suffix>` -> the `--ih-*` custom property behind
 * it, read from the `@theme` alias block so a token rename cannot quietly
 * defang the gate.
 *
 * A `bg-ih-*` with no entry here is not a niche case: Tailwind emits NOTHING
 * for it, so the element paints no background at all. `bg-ih-bg-input` (18 call
 * sites) and `bg-ih-status-watch-bg` are both in that state today.
 */
export function aliasMap(css) {
  const map = new Map();
  const re = /--color-ih-([a-z0-9-]+)\s*:\s*var\(\s*(--ih-[a-z0-9-]+)/g;
  let m;
  while ((m = re.exec(css)) !== null) map.set(m[1], m[2]);
  return map;
}

/**
 * The FALLBACK written into each `@theme` alias, i.e. the `#fff` in
 * `--color-ih-primary-fg: var(--ih-primary-fg, #ffffff)`.
 *
 * Worth reading separately because a fallback is what turns "this token is not
 * defined" into something a browser paints anyway: the page renders one fixed
 * colour in every theme while the stylesheet looks, to a reader, as though the
 * token exists. That is exactly how `--ih-primary-fg` shipped white label text
 * on a light indigo fill in dark and field (2.98:1) with every gate green.
 */
export function aliasFallbacks(css) {
  const map = new Map();
  const re = /--color-ih-([a-z0-9-]+)\s*:\s*var\(\s*--ih-[a-z0-9-]+\s*,\s*([^)]+)\)/g;
  let m;
  while ((m = re.exec(css)) !== null) map.set(m[1], m[2].trim());
  return map;
}

/** 1-based line of a character offset. */
const lineAt = (css, index) => css.slice(0, index).split("\n").length;

/**
 * Rules in the stylesheet that set a TEXT COLOUR from an `--ih-*` token.
 *
 * The gate proper reads Tailwind class strings, so a colour set in plain CSS is
 * invisible to it — named in its own comments as a blind spot, and `.ih-eyebrow`
 * (`color: var(--ih-fg-4)` at 9px) was the live example. Nothing about a CSS rule
 * makes it harder to measure than a class string; it was simply never read.
 *
 * Returns `[{ selector, line, fg, bg, sizePx, sizeFrom }]`:
 *   - `fg` / `bg` are `--ih-*` property names; `bg` is null when the rule paints
 *     no background of its own (the reference surface then applies, exactly as
 *     for an element with no `bg-ih-*`).
 *   - `sizePx` is the rule's own `font-size` in px, or the px size of its BEM
 *     base class (`.ih-pill` for `.ih-pill--ni`), or null. `.ih-pill` really does
 *     keep the size and the modifiers really do keep the colour, so without the
 *     base-class step every status pill reads as size-unknown.
 *   - a non-px `font-size` (`1.125em`) leaves `sizePx` null rather than guessing.
 *
 * Theme blocks and `@theme` are skipped: they declare token VALUES, not text.
 */
export function cssTextRules(css) {
  const skip = [":root", "data-color-scheme", ".dark", "@theme", "@keyframes", "@media"];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  const raw = [];
  let m;
  while ((m = re.exec(css)) !== null) {
    const selector = m[1].replace(/\/\*[\s\S]*?\*\//g, "").trim();
    if (!selector || skip.some((s) => selector.includes(s))) continue;
    const body = m[2];
    const fg = /(?<!-)color\s*:\s*var\(\s*(--ih-[a-z0-9-]+)/.exec(body)?.[1] ?? null;
    const bg = /background(?:-color)?\s*:\s*var\(\s*(--ih-[a-z0-9-]+)/.exec(body)?.[1] ?? null;
    const sizePx = /font-size\s*:\s*(\d+(?:\.\d+)?)px/.exec(body)?.[1] ?? null;
    raw.push({
      selector,
      line: lineAt(css, m.index),
      fg,
      bg,
      ownSize: sizePx === null ? null : Number(sizePx),
    });
  }

  // `.ih-pill { font-size: 11px }` + `.ih-pill--ni { color: … }`.
  const baseSize = new Map();
  for (const r of raw) {
    if (r.ownSize !== null && /^\.[a-z0-9-]+$/i.test(r.selector)) baseSize.set(r.selector, r.ownSize);
  }

  return raw
    .filter((r) => r.fg)
    .map((r) => {
      if (r.ownSize !== null) return { ...r, sizePx: r.ownSize, sizeFrom: "own" };
      const base = /^(\.[a-z0-9]+(?:-[a-z0-9]+)*?)--/i.exec(r.selector)?.[1];
      if (base && baseSize.has(base)) {
        return { ...r, sizePx: baseSize.get(base), sizeFrom: `base ${base}` };
      }
      return { ...r, sizePx: null, sizeFrom: null };
    });
}
