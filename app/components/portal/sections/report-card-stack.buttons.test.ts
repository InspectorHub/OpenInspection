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
    // container. Confirm the "Print" label is rendered via the i18n message
    // (m.report_view_print() → "Print"), not the old ">PDF<" literal.
    expect(text).toContain('m.report_view_print()');
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

  // The fetch→blob download + generating/cooldown state moved into the shared
  // `usePdfExport` hook (so every Browser-Rendering-backed surface degrades
  // identically). ReportView now delegates to it; the impl assertions follow the
  // logic into the hook, while ReportView keeps the URL construction + wiring.
  it('FAB label is produced by the shared hook ("Generating…" / "Retry in Ns")', async () => {
    const view = ((await import('~/components/portal/sections/ReportView?raw')) as unknown as { default: string }).default;
    const hook = ((await import('~/hooks/usePdfExport?raw')) as unknown as { default: string }).default;

    expect(view).toContain('pdfActionLabel(pdf, m.report_view_download_pdf())');
    // The generating / cooldown labels moved into the i18n catalog; the hook
    // resolves them via these message keys.
    expect(hook).toContain('helper_pdf_generating');
    expect(hook).toContain('helper_pdf_retry_in');
  });

  it('generating state lives in the shared usePdfExport hook', async () => {
    const view = ((await import('~/components/portal/sections/ReportView?raw')) as unknown as { default: string }).default;
    const hook = ((await import('~/hooks/usePdfExport?raw')) as unknown as { default: string }).default;

    expect(view).toContain('usePdfExport()');
    expect(view).toContain('pdf.busy');
    expect(hook).toContain('setGenerating');
  });

  it('downloadPdf delegates to the hook, which uses fetch (not window.print)', async () => {
    const view = ((await import('~/components/portal/sections/ReportView?raw')) as unknown as { default: string }).default;
    const hook = ((await import('~/hooks/usePdfExport?raw')) as unknown as { default: string }).default;

    expect(view).toContain('downloadPdf');
    expect(view).toContain('pdf.exportPdf(');
    expect(hook).toContain('await fetch(');
  });

  it('the hook creates a blob and anchor download (not window.print)', async () => {
    const hook = ((await import('~/hooks/usePdfExport?raw')) as unknown as { default: string }).default;

    expect(hook).toContain('res.blob()');
    expect(hook).toContain('URL.createObjectURL');
    expect(hook).toContain('a.download');
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
