import type { ReportLoaderResult } from "./types";
import { UnitConditionMatrix } from "./UnitConditionMatrix";
import { UnitSections } from "./UnitSections";

/**
 * Commercial PCA Phase U — the per-unit report render, extracted from ReportView
 * so the monolith does not absorb the whole matrix/exception surface. STRICTLY
 * gated on per_unit mode: the condition matrix + exception detail render above
 * the common sections (which in per_unit mode carry the `_default` common-areas
 * findings — that is correct). In tagged/residential mode this renders nothing,
 * so the report is byte-identical.
 */
export function PerUnitReportBlock({
  data,
}: {
  data: Pick<ReportLoaderResult, "unitInspectionMode" | "unitConditionMatrix" | "sections" | "defectCountsByUnit">;
}) {
  if (data.unitInspectionMode !== "per_unit") return null;
  return (
    <>
      <UnitConditionMatrix rows={data.unitConditionMatrix} sections={data.sections} defectCounts={data.defectCountsByUnit} />
      <UnitSections rows={data.unitConditionMatrix} sections={data.sections} />
    </>
  );
}
