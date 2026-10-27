// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { FALLBACK_RATING_COLOR, isFallbackRatingColor, readableTextOn, safeCssColor, tintOf, tintedChipStyle } from './readable-text';

/** The WCAG contrast formula, written out again here rather than read from the code under test. */
function channel(c: number) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function lum(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
function contrast(a: string, b: string) {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe('readableTextOn', () => {
  it.each([
    ['#ef4444', 'white'], ['#3b82f6', 'white'], ['#22c55e', 'dark'], ['#f59e0b', 'dark'], ['#cbd5e1', 'dark'],
    ['#6b7280', 'white'], ['#94a3b8', 'dark'], ['#9ca3af', 'dark'], ['#d4d4d8', 'dark'], ['#1d4ed8', 'white'],
    ['#7c3aed', 'white'], ['#b91c1c', 'white'], ['#fff', 'dark'], ['#000', 'white'],
  ])('%s gets %s text', (bg, expected) => {
    const text = readableTextOn(bg)!;
    expect(text === '#ffffff' ? 'white' : 'dark').toBe(expected);
  });

  it('keeps white while it reads at 3:1 or better, and otherwise picks the better of white and dark ink', () => {
    for (let r = 0; r <= 255; r += 51) for (let g = 0; g <= 255; g += 51) for (let b = 0; b <= 255; b += 51) {
      const bg = '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
      const text = readableTextOn(bg)!;
      const white = contrast('#ffffff', bg);
      const ink = contrast('#0f172a', bg);
      if (white >= 3) expect(text, bg).toBe('#ffffff');
      else expect(contrast(text, bg), bg).toBeGreaterThanOrEqual(Math.max(white, ink) - 1e-9);
    }
  });

  it('reads rgb() and rgba() the same way as hex', () => {
    expect(readableTextOn('rgb(239, 68, 68)')).toBe('#ffffff');
    expect(readableTextOn('rgb(34, 197, 94)')).toBe('#0f172a');
    expect(readableTextOn('rgba(203, 213, 225, 0.9)')).toBe('#0f172a');
  });

  it('CONTROL - a var() token, a name or nothing leaves the caller on its own text colour, and never reads the document', () => {
    const style = vi.spyOn(window, 'getComputedStyle');
    expect(readableTextOn('var(--ih-fg-5, #d4d4d8)')).toBeNull();
    expect(readableTextOn('var(--unknown)')).toBeNull();
    expect(readableTextOn('rebeccapurple')).toBeNull();
    expect(readableTextOn(undefined)).toBeNull();
    expect(style).not.toHaveBeenCalled();
    style.mockRestore();
  });
});

// The fallback fill for a rating with no colour is made of two design tokens, so it must be legible in each theme.
describe('the fallback rating fill', () => {
  const css = readFileSync(join(process.cwd(), 'packages', 'field-ui', 'src', 'theme.css'), 'utf8');
  /** The value of `--name` inside the block that starts at `selector`. */
  const token = (selector: string, name: string) => {
    const at = css.indexOf(selector);
    const block = css.slice(at, css.indexOf('}', at));
    return new RegExp(name + ':[ ]*(#[0-9a-f]{6})', 'i').exec(block)![1]!;
  };

  it.each([
    ['light', ':root {'],
    ['dark', 'html[data-color-scheme="dark"], html[data-color-scheme="field"], .dark {'],
  ])('bg-ih-bg-muted with text-ih-fg-1 is at least 4.5:1 in the %s theme', (_theme, selector) => {
    expect(contrast(token(selector, '--ih-fg-1'), token(selector, '--ih-bg-muted'))).toBeGreaterThanOrEqual(4.5);
  });

  it('is recognised by its exact value, and no hex or tenant colour is mistaken for it', () => {
    expect(isFallbackRatingColor(FALLBACK_RATING_COLOR)).toBe(true);
    expect(isFallbackRatingColor('#d4d4d8')).toBe(false);
    expect(isFallbackRatingColor('var(--ih-status-ok, #10b981)')).toBe(false);
    expect(isFallbackRatingColor(undefined)).toBe(false);
  });
});

// A tenant's rating colour is an unvalidated string that ends up in a style attribute: only plain colours get through.
describe('readableTextOn for colour names', () => {
  it.each([['red', '#ffffff'], ['blue', '#ffffff'], ['green', '#ffffff'], ['teal', '#ffffff'], ['purple', '#ffffff'], ['brown', '#ffffff'], ['gray', '#ffffff'], ['black', '#ffffff'],
    ['indigo', '#ffffff'], ['yellow', '#0f172a'], ['orange', '#0f172a'], ['pink', '#0f172a'], ['white', '#0f172a'], ['Yellow', '#0f172a']])('%s gets %s text', (name, text) => {
    expect(readableTextOn(name)).toBe(text);
  });

  it('CONTROL - a name it has no colour for (a Tailwind-only name, transparent) leaves the caller on its own text colour', () => {
    for (const name of ['amber', 'slate', 'transparent', 'currentColor', 'constructor', 'toString', '__proto__']) expect(readableTextOn(name)).toBeNull();
  });
});

describe('tintedChipStyle (the library rating chips)', () => {
  it('tints a 6-digit hex and colours the text; a name keeps the text colour and gets no tint; an unsafe value gets nothing', () => {
    expect(tintedChipStyle('#ef4444')).toEqual({ backgroundColor: '#ef44441a', color: '#ef4444' });
    expect(tintedChipStyle('red')).toEqual({ backgroundColor: undefined, color: 'red' });
    expect(tintedChipStyle('url(x)')).toEqual({ backgroundColor: undefined, color: undefined });
  });
});

describe('tintOf', () => {
  it('appends the alpha only to a 6-digit hex, and gives nothing for any other form', () => {
    expect(tintOf('#ef4444', '1a')).toBe('#ef44441a');
    for (const c of ['#fff', '#ef444480', 'rgb(1,2,3)', 'red', 'var(--ih-fg-5)', null, undefined]) expect(tintOf(c, '1a'), String(c)).toBeNull();
  });
});

describe('safeCssColor', () => {
  it.each([
    '#fff', '#FFFA', '#1d4ed8', '#1d4ed8cc', 'rgb(29, 78, 216)', 'rgba(29,78,216,0.5)', 'rgb(29 78 216 / 50%)',
    'hsl(220, 80%, 48%)', 'hsla(220 80% 48% / .5)', 'hsl(220deg 80% 48%)',
    'red', 'Teal', 'indigo', 'grey',
    'var(--ih-fg-5)', 'var(--ih-status-ok, #10b981)', 'var(--ih-fg-5, #d4d4d8)', 'var(--ih-a, var(--ih-b, #fff))',
  ])('accepts %s', (c) => expect(safeCssColor(c)).toBe(c));

  it.each([
    'url(https://x)', 'red; background:url(x)', 'red;', '#fff; color:red', 'expression(alert(1))', '"red"', "'red'",
    'rgb(1,2,3){}', 'rgb(1,2,url(x))', 'rgb(1,2,3', 'calc(1px + 2px)', 'var(--x)', 'var(--ih-x, url(x))', 'var(--ih-a, var(--x, #fff))', 'var(--ih-a, var(--ih-b, url(x)))', 'var(--ih-x, red; x:y)',
    '#ggg', '#12345', 'linear-gradient(red, blue)', 'red;x', 'red url(x)', 're d', 're', 'red!', 'red/*x*/',
    // words that are not CSS colours: Tailwind names, keywords and anything else
    'amber', 'slate', 'rose', 'emerald', 'transparent', 'currentColor', 'foo', 'rebeccapurple', 'constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__', '#fff\\', '#f\nff', 'rgb(1,2,3)/*x*/', '', '   ',
  ])('rejects %j', (c) => expect(safeCssColor(c)).toBeNull());

  it('rejects what is not a string, and trims what is', () => {
    expect(safeCssColor(undefined)).toBeNull();
    expect(safeCssColor(null)).toBeNull();
    expect(safeCssColor(42 as never)).toBeNull();
    expect(safeCssColor('  #fff  ')).toBe('#fff');
  });
});
