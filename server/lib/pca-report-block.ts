/**
 * Commercial PCA Phase S — assemble the report skeleton payload block, GATED to
 * commercial reports.
 *
 * This is the single place that decides PCA report visibility. Residential home
 * inspections (the core product) must NOT render the ASTM PCA front matter
 * (Transmittal Letter, Systems Summary, Deviations, User Reliance, …), so this
 * returns `null` unless the inspection is a commercial report. Mirrors the
 * Phase F pattern where the server decides visibility and the report layer
 * renders whatever it is handed (`null` → `PcaSkeleton` renders nothing).
 *
 * Server-only: composes the server-only registry / narrative / systems-summary
 * pieces. The app side consumes the re-declared types in report/types.ts.
 */
import { PCA_SECTION_REGISTRY } from './pca-section-registry';
import { resolvePcaNarrative, type PcaNarrative } from './pca-narrative';
import { buildSystemsSummary, type SystemsSummaryInput, type SystemsSummaryRow } from './pca-systems-summary';
import type { PcaSectionEntry } from './pca-section-registry';
import type { Deviation } from './pca-deviations';

export interface PcaReportBlock {
  sectionRegistry: PcaSectionEntry[];
  narrative: PcaNarrative;
  systemsSummary: SystemsSummaryRow[];
  deviations: Deviation[];
}

export function buildPcaReportBlock(input: {
  propertyType?: string | null;
  pcaNarrative?: unknown;
  deviations?: Deviation[] | null;
  sections: SystemsSummaryInput[];
}): PcaReportBlock | null {
  // Gate: only commercial reports carry the PCA skeleton.
  if (input.propertyType !== 'commercial') return null;
  return {
    sectionRegistry: [...PCA_SECTION_REGISTRY],
    narrative: resolvePcaNarrative(input.pcaNarrative),
    systemsSummary: buildSystemsSummary(input.sections),
    deviations: input.deviations ?? [],
  };
}
