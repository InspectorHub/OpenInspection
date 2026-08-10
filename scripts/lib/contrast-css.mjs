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
