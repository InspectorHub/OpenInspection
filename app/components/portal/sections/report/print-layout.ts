/**
 * Print-layout constants for the report render.
 *
 * Split out of `types.ts` when that file reached the large-file limit, on the
 * seam the file already drew for itself: everything else there describes the
 * SHAPE of report data, and these describe how it is laid out on paper. They
 * grow for different reasons — a new payload field is not a new page-break
 * rule — and only these are PRINT-ONLY, with on-screen rendering unchanged.
 *
 * `types.ts` re-exports every name here, so no import site changed.
 */
/* ------------------------------------------------------------------ */
/* Print layout constants (exported for tests + re-exported via the    */
/* standalone route). PRINT-ONLY — on-screen rendering is unchanged.   */
/* ------------------------------------------------------------------ */

/** Inspection-item / defect / stats cards: never split a card across pages. */
export const PRINT_CARD_CLASS = "print:break-inside-avoid";
/** Photo cells: never split a photo across a page boundary. */
export const PRINT_FIGURE_CLASS = "print:break-inside-avoid";
/** Section headings: keep a heading glued to the content that follows. */
export const PRINT_SECTION_HEADING_CLASS = "print:break-after-avoid";
/** Defect photo grid (screen 3/4-col) collapses to a dense 3-col in print. */
export const DEFECT_PHOTO_GRID_CLASS =
  "grid grid-cols-3 sm:grid-cols-4 print:grid-cols-3 gap-1.5";
/** Item photo grid (screen 2/3-col) collapses to a dense 3-col in print. */
export const ITEM_PHOTO_GRID_CLASS =
  "grid grid-cols-2 sm:grid-cols-3 print:grid-cols-3 gap-2";
/** CF Images thumbnail width: smaller in print to keep the PDF lean. */
export const printThumbWidth = (isPrint: boolean): number => (isPrint ? 480 : 800);

/** Report heading typography — driven by the resolved profile's `--report-*`
 *  vars (Report Style Presets). Shared by the report title and every section
 *  heading, so a preset can never restyle one of them and miss the other. */
export const REPORT_HEADING_STYLE = { fontFamily: "var(--report-heading-font)", fontWeight: "var(--report-heading-weight)" as unknown as number, letterSpacing: "var(--report-heading-spacing)", textTransform: "var(--report-heading-transform)" as unknown as "none" };
