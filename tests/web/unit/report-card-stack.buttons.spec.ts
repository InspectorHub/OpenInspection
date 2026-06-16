// tests/web/unit/report-card-stack.buttons.spec.ts
//
// Task 9 — Verifies that:
//   1. The top-bar button previously labelled "PDF" is relabelled "Print"
//      (it keeps window.print() behaviour — that is just a label rename).
//   2. The bottom-right FAB is labelled "Download PDF" (unchanged label) but
//      its onClick handler is now downloadPdf (a fetch→blob flow), NOT
//      window.print().
//   3. The component has a `generating` state that disables and relabels the
//      FAB while the download is in flight.
//   4. Owner vs. client URL selection is correct:
//        - token present  → /api/public/report/:tenant/:id/pdf?type=full&token=…
//        - no token       → /api/inspections/:id/pdf?type=full
//   5. No native dialogs (window.alert/confirm/prompt) are used in the
//      download handler.
//
// Strategy: raw-source inspection (same pattern as sidebar.spec.ts and
// report-card-stack.summary.spec.ts) — avoids the full React + router
// context setup overhead while still asserting the actual shipped text.

import { describe, it, expect } from 'vitest';

describe('report-card-stack buttons (Task 9)', () => {
  it('loads the module source', async () => {
    const src = await import('~/components/portal/sections/ReportView?raw');
    const text = (src as unknown as { default: string }).default;
    expect(text.length).toBeGreaterThan(0);
  });

  it('top-bar toolbar button reads "Print" (not "PDF")', async () => {
    const src = await import('~/components/portal/sections/ReportView?raw');
    const text = (src as unknown as { default: string }).default;

    // The top-bar toolbar sits inside the `flex items-center gap-2 print:hidden`
    // container. Confirm "Print" label is present as a JSX text node.
    // The label is on its own indented line between the button tags (whitespace-surrounded).
    // We look for the word "Print" as a standalone label (not part of "window.print()").
    expect(text).toMatch(/>\s*Print\s*<\/button>/m);
  });

  it('top-bar toolbar button no longer reads ">PDF<"', async () => {
    const src = await import('~/components/portal/sections/ReportView?raw');
    const text = (src as unknown as { default: string }).default;

    // The label "PDF" as a JSX text node (between tags) must be gone from the
    // top-bar button. Note: "Export PDF" (repair panel) and "Download PDF"
    // (FAB) may still legitimately contain "PDF" — this assertion is scoped to
    // the bare ">PDF<" form which was the old top-bar button text.
    expect(text).not.toContain('>PDF<');
  });

  it('FAB button still reads "Download PDF" as the default label', async () => {
    const src = await import('~/components/portal/sections/ReportView?raw');
    const text = (src as unknown as { default: string }).default;

    expect(text).toContain('Download PDF');
  });

  it('FAB button shows "Generating…" label when generating is true', async () => {
    const src = await import('~/components/portal/sections/ReportView?raw');
    const text = (src as unknown as { default: string }).default;

    // The conditional label text must appear in source.
    expect(text).toContain('Generating');
  });

  it('generating state variable is declared', async () => {
    const src = await import('~/components/portal/sections/ReportView?raw');
    const text = (src as unknown as { default: string }).default;

    expect(text).toContain('generating');
    expect(text).toContain('setGenerating');
  });

  it('downloadPdf handler uses fetch (not window.print)', async () => {
    const src = await import('~/components/portal/sections/ReportView?raw');
    const text = (src as unknown as { default: string }).default;

    // The async downloadPdf function must call fetch.
    expect(text).toContain('downloadPdf');
    expect(text).toContain('await fetch(');
  });

  it('downloadPdf creates a blob and anchor download (not window.print)', async () => {
    const src = await import('~/components/portal/sections/ReportView?raw');
    const text = (src as unknown as { default: string }).default;

    expect(text).toContain('res.blob()');
    expect(text).toContain('URL.createObjectURL');
    expect(text).toContain('a.download');
  });

  it('owner URL path: /api/inspections/:id/pdf', async () => {
    const src = await import('~/components/portal/sections/ReportView?raw');
    const text = (src as unknown as { default: string }).default;

    expect(text).toContain('/api/inspections/');
    expect(text).toContain('/pdf?type=full');
  });

  it('client URL path: /api/public/report/:tenant/:id/pdf with token', async () => {
    const src = await import('~/components/portal/sections/ReportView?raw');
    const text = (src as unknown as { default: string }).default;

    expect(text).toContain('/api/public/report/');
    expect(text).toContain('token');
  });

  it('FAB onClick is downloadPdf (not window.print)', async () => {
    const src = await import('~/components/portal/sections/ReportView?raw');
    const text = (src as unknown as { default: string }).default;

    // The fixed bottom-6 right-6 FAB must reference downloadPdf in its onClick.
    // We check that "onClick={downloadPdf}" appears in the source.
    expect(text).toContain('onClick={downloadPdf}');
  });

  it('no native alert/confirm/prompt in downloadPdf handler', async () => {
    const src = await import('~/components/portal/sections/ReportView?raw');
    const text = (src as unknown as { default: string }).default;

    // Extract the downloadPdf function body to check for native dialogs.
    const fnStart = text.indexOf('const downloadPdf');
    expect(fnStart).toBeGreaterThan(-1);
    // Grab up to 2000 chars of the function body (enough to cover the full handler).
    const fnBody = text.slice(fnStart, fnStart + 2000);
    expect(fnBody).not.toContain('window.alert');
    expect(fnBody).not.toContain('window.confirm');
    expect(fnBody).not.toContain('window.prompt');
  });

  it('top-bar print button still calls window.print()', async () => {
    const src = await import('~/components/portal/sections/ReportView?raw');
    const text = (src as unknown as { default: string }).default;

    // window.print() must still appear (for the top-bar Print button and
    // the repair-panel "Export PDF" button).
    expect(text).toContain('window.print()');
  });
});
