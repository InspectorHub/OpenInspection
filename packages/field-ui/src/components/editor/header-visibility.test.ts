import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HEADER_OVERFLOW, pivotBreakpoint } from './header-visibility';

// `import.meta.url` is not a file: URL under the web vitest config (the module
// graph is served by Vite), so resolve from the repo root instead.
const dir = join(process.cwd(), 'app', 'components', 'editor');
const read = (f: string) => readFileSync(join(dir, f), 'utf8');
const HEADER_SRC = read('EditorHeader.tsx');
const OVERFLOW_SRC = read('HeaderOverflowMenu.tsx');
const PREVIEW_SRC = read('PreviewMenu.tsx');

describe('editor header visibility table', () => {
  it('pairs every COMPOSE-tier control on one breakpoint', () => {
    for (const [key, pair] of Object.entries(HEADER_OVERFLOW)) {
      expect(pivotBreakpoint(pair), `${key} is not an inverse pair`).not.toBeNull();
    }
  });

  it('rejects a pair whose two sides pivot on different breakpoints', () => {
    expect(pivotBreakpoint({ inline: 'hidden xl:inline-flex', row: 'lg:hidden' })).toBeNull();
  });

  it('rejects an "inline" class that is not hidden by default', () => {
    // Without a bare `hidden`, the button shows at every width and the overflow
    // row duplicates it below the breakpoint.
    expect(pivotBreakpoint({ inline: 'xl:inline-flex', row: 'xl:hidden' })).toBeNull();
  });

  /**
   * The table is only load-bearing while both sides actually read it. A
   * hand-written `className="xl:hidden"` next to it would look identical and
   * drift on the next breakpoint change, which is the whole failure mode this
   * file exists to remove.
   */
  it('is the source both the header and the overflow menu read from', () => {
    for (const src of [HEADER_SRC, OVERFLOW_SRC]) {
      expect(src).toContain('HEADER_OVERFLOW');
    }
    for (const key of Object.keys(HEADER_OVERFLOW)) {
      expect(HEADER_SRC, `header does not consume HEADER_OVERFLOW.${key}`)
        .toContain(`HEADER_OVERFLOW.${key}.inline`);
      expect(OVERFLOW_SRC, `overflow menu does not consume HEADER_OVERFLOW.${key}`)
        .toContain(`HEADER_OVERFLOW.${key}.row`);
    }
  });

  it('hides the overflow trigger where every control it holds is inline again', () => {
    // Sign, version history and theme all return at xl, so at xl the menu is
    // empty and its trigger must not render.
    const bps = new Set(Object.values(HEADER_OVERFLOW).map(pivotBreakpoint));
    expect(bps.has('xl')).toBe(true);
    expect(OVERFLOW_SRC).toContain('className="xl:hidden"');
  });
});

describe('Preview is never width-gated', () => {
  /**
   * The regression this layout exists to prevent: Publish never hides, so
   * neither may the control that shows you what you are about to publish.
   * Before this, the web report was 2xl-only and the PDF xl-only, which left
   * the entire 768-1279px band — iPad landscape included — able to publish a
   * report it had no way to look at first.
   */
  it('renders no responsive hide class on the Preview trigger', () => {
    const trigger = PREVIEW_SRC.slice(0, PREVIEW_SRC.indexOf('</Button>'));
    expect(trigger).not.toMatch(/\b(?:sm|md|lg|xl|2xl):(?:inline-flex|flex|hidden)\b/);
  });

  it('leaves no 2xl-gated action button in the header', () => {
    expect(HEADER_SRC).not.toContain('2xl:inline-flex');
  });

  it('reaches both fidelities from the one control', () => {
    expect(PREVIEW_SRC).toContain('preview-report-btn');
    expect(PREVIEW_SRC).toContain('preview-pdf-btn');
  });
});
