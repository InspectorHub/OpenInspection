import type { AstmConformance } from "./types";

/**
 * Commercial PCA Phase M — the ASTM E2018 §1.4-adjacent conformance
 * statement ("This report conforms / does not conform to ASTM {standard}.").
 * Renders nothing when `conformance` is null (light/residential reports, or
 * full-PCA reports where the field hasn't been captured yet).
 */
export function ConformanceStatement({ conformance }: { conformance: AstmConformance | null }) {
  if (conformance == null) return null;
  const verb = conformance.conforms ? "conforms" : "does not conform";
  return (
    <p data-pca-conformance className="text-sm text-ih-fg-1 print:break-inside-avoid">
      This report {verb} to ASTM {conformance.standard}.
    </p>
  );
}
