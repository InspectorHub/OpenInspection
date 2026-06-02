/**
 * B-8 fix — map the New Inspection wizard's form fields to the
 * CreateInspectionSchema JSON that POST /api/inspections expects.
 *
 * The wizard posts a separate `date` (YYYY-MM-DD) + `time` (HH:MM); the API
 * wants a single ISO datetime, so we combine them here. `templateId` and
 * `propertyAddress` are required by the schema; `date`/`inspectorId` are
 * omitted when absent so the API applies its own defaults.
 */
export interface CreateInspectionJson {
  propertyAddress: string;
  templateId: string;
  date?: string;
  inspectorId?: string;
}

export function buildCreateInspectionJson(formData: FormData): CreateInspectionJson {
  const address = String(formData.get("address") || "");
  const templateId = String(formData.get("templateId") || "");
  const dateStr = String(formData.get("date") || "");
  const time = String(formData.get("time") || "") || "09:00";
  const inspectorId = String(formData.get("inspectorId") || "");

  return {
    propertyAddress: address,
    templateId,
    ...(dateStr ? { date: `${dateStr}T${time}:00Z` } : {}),
    ...(inspectorId ? { inspectorId } : {}),
  };
}
