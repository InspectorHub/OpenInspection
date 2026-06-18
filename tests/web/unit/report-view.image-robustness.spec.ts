// tests/web/unit/report-view.image-robustness.spec.ts
//
// Plan 1 (N1) — client report image robustness.
//
// The client-facing report (now rendered by <ReportView>, extracted from the
// former report-card-stack route) must degrade gracefully when images fail:
//   1. Cover photo failure renders a restrained placeholder panel
//      ("Cover photo unavailable") instead of hiding the whole section via
//      parentElement.style.display = "none".
//   2. Defect-photo and item-photo thumbnails gain an onError handler so a
//      broken thumbnail collapses (no browser broken-image glyph) and an
//      explicit aspect-ratio box so lazy-load causes no layout shift (CLS).
//   3. Thumbnail alt text is human-readable (defect/item title), not the raw
//      photo key / technical filename.
//
// Strategy: raw-source inspection — same harness as
// report-card-stack.buttons.spec.ts and report-card-stack.render-forward.spec.ts.
// Reverting any fix below makes a specific assertion fail.

import { describe, it, expect } from 'vitest';

async function source(): Promise<string> {
  const src = await import('~/components/portal/sections/ReportView?raw');
  return (src as unknown as { default: string }).default;
}

describe('ReportView image robustness (Plan 1 / N1)', () => {
  it('loads the module source', async () => {
    const text = await source();
    expect(text.length).toBeGreaterThan(0);
  });

  it('cover no longer hides its section by mutating parentElement display', async () => {
    const text = await source();
    // The old fix collapsed the entire cover section on error. It must be gone.
    expect(text).not.toMatch(/parentElement[^;]*style\.display\s*=\s*["']none["']/);
  });

  it('cover renders a restrained "Cover photo unavailable" placeholder', async () => {
    const text = await source();
    expect(text).toContain('Cover photo unavailable');
    // The placeholder is a co-located presentational component.
    expect(text).toContain('function CoverPhotoPlaceholder');
  });

  it('cover image error path flips React state, not a DOM mutation', async () => {
    const text = await source();
    // onError sets a boolean state flag (coverFailed) rather than touching the DOM.
    expect(text).toMatch(/setCoverFailed\(\s*true\s*\)/);
  });

  it('photo thumbnails track failures in a state Set and collapse on error', async () => {
    const text = await source();
    // A shared failed-photo Set drives graceful collapse for grid thumbnails.
    expect(text).toContain('failedPhotos');
    expect(text).toContain('markPhotoFailed');
    // Both grids must wire onError to markPhotoFailed.
    const onErrorCount = (text.match(/onError=\{\(\)\s*=>\s*markPhotoFailed\(/g) ?? []).length;
    expect(onErrorCount).toBeGreaterThanOrEqual(2);
  });

  it('photo thumbnails use an explicit aspect-ratio box to prevent CLS', async () => {
    const text = await source();
    // Both grids wrap thumbnails in an aspect-[4/3] box so the lazy <img>
    // reserves space before it loads (no layout shift).
    const aspectCount = (text.match(/aspect-\[4\/3\]/g) ?? []).length;
    expect(aspectCount).toBeGreaterThanOrEqual(2);
  });

  it('defect thumbnails use a human-readable alt (defect title, not the key)', async () => {
    const text = await source();
    // The FE-3 defect grid must derive alt from the defect title d.title.
    expect(text).toMatch(/alt=\{`?[^`}]*\$\{d\.title\}/);
  });

  it('item thumbnails use a human-readable alt (item label, not the key)', async () => {
    const text = await source();
    // The item-photo grid must derive alt from the item label item.label.
    expect(text).toMatch(/alt=\{`?[^`}]*\$\{item\.label\}/);
  });
});
