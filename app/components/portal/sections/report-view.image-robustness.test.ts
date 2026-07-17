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

// The report render was split into ReportView + colocated ./report/*
// sub-components (structural refactor). The intent markers asserted below now
// live across that fileset, so we concatenate the relevant module sources.
async function source(): Promise<string> {
  const mods = await Promise.all([
    import('~/components/portal/sections/ReportView?raw'),
    import('~/components/portal/sections/report/ReportMediaTile?raw'),
    import('~/components/portal/sections/report/ReportDefectCard?raw'),
  ]);
  return mods.map((m) => (m as unknown as { default: string }).default).join('\n');
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
    // The placeholder copy is now the i18n message (m.report_view_cover_unavailable() → "Cover photo unavailable").
    expect(text).toContain('m.report_view_cover_unavailable()');
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
    // Plan 7 — both grids render through the shared renderMediaTile helper, whose
    // image branch wires onError → the failed-photo marker. Post-split the marker
    // is threaded as the onPhotoFailed prop into <ReportMediaTile> (which calls
    // markPhotoFailed), so the wiring is verified across the two ends.
    expect(text).toMatch(/onError=\{\(\)\s*=>\s*onPhotoFailed\(/);
    expect(text).toContain('onPhotoFailed={markPhotoFailed}');
    expect(text).toContain('renderMediaTile');
    // The collapse filter (mediaVisible) is applied at BOTH grid call sites.
    const visibleCount = (text.match(/\.filter\(mediaVisible\)/g) ?? []).length;
    expect(visibleCount).toBeGreaterThanOrEqual(2);
  });

  it('photo thumbnails use an explicit aspect-ratio box to prevent CLS', async () => {
    const text = await source();
    // The shared image tile (renderMediaTile) wraps the lazy <img> in an
    // aspect-[4/3] box so it reserves space before it loads (no layout shift);
    // the video tile uses aspect-video for the same reason.
    expect(text).toContain('aspect-[4/3]');
    expect(text).toContain('aspect-video');
  });

  it('defect thumbnails use a human-readable alt (defect title, not the key)', async () => {
    const text = await source();
    // Plan 7 — the defect grid passes a human-readable alt (defect title) into
    // the shared renderMediaTile, which applies it via alt={alt} on every tile.
    expect(text).toMatch(/renderMediaTile\(photo, `\$\{d\.title\}/);
    expect(text).toContain('alt={alt}');
  });

  it('item thumbnails use a human-readable alt (item label, not the key)', async () => {
    const text = await source();
    // Plan 7 — the item grid passes a human-readable alt (item label) into the
    // shared renderMediaTile, which applies it via alt={alt} on every tile.
    expect(text).toMatch(/renderMediaTile\(photo, `\$\{item\.label\}/);
    expect(text).toContain('alt={alt}');
  });

  it('R2 videos render (player + poster) and are never collapsed — they must not vanish from the report', async () => {
    const text = await source();
    // The default R2 backend's videos have streamUid=null; the selector resolves
    // them to r2-video-* kinds. ReportMediaTile MUST branch on both, or R2 videos
    // fall through to the broken-image branch and silently disappear (the
    // regression the whole-branch review caught).
    expect(text).toContain('r2-video-player');
    expect(text).toContain('r2-video-poster');
    // mediaVisible must treat the R2 video kinds as visible (like Stream kinds),
    // so a failed-image filter never hides them.
    expect(text).toMatch(/kind === "r2-video-player"/);
    expect(text).toMatch(/kind === "r2-video-poster"/);
  });
});
