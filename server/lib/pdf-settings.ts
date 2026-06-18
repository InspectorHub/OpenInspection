/**
 * Report PDF settings resolver (2026-06-18).
 *
 * Pure projection of the tenant_configs PDF columns into the shape the report
 * print layout consumes. Centralises the "default ON" fallback so every reader
 * (loader, renderer, settings UI) agrees on the effective value when a column is
 * null/absent (e.g. a tenant whose config row predates these columns).
 */
export interface PdfSettings {
  showFooter: boolean;
  showPageNumbers: boolean;
  showLicense: boolean;
  companyAddress: string | null;
}

export function resolvePdfSettings(
  cfg:
    | Partial<{
        pdfShowFooter: boolean;
        pdfShowPageNumbers: boolean;
        pdfShowLicense: boolean;
        companyAddress: string | null;
      }>
    | null
    | undefined,
): PdfSettings {
  return {
    showFooter: cfg?.pdfShowFooter ?? true,
    showPageNumbers: cfg?.pdfShowPageNumbers ?? true,
    showLicense: cfg?.pdfShowLicense ?? true,
    companyAddress: cfg?.companyAddress ?? null,
  };
}
