/**
 * B-8 fix — map the New Inspection wizard's form fields to the
 * CreateInspectionSchema JSON that POST /api/inspections expects.
 *
 * The wizard posts a separate `date` (YYYY-MM-DD) + `time` (HH:MM); the API
 * wants a single ISO datetime, so we combine them here. `templateId` and
 * `propertyAddress` are required by the schema; `date`/`inspectorId`/
 * `serviceIds` are omitted when absent so the API applies its own defaults.
 *
 * `serviceIds` arrives as a comma-joined string of tenant service IDs (the
 * Services step now lists the tenant's real services, not free-text labels).
 * The service layer matches these against the `services` table and silently
 * ignores unknown IDs, so a stale/empty value is harmless.
 *
 * `inspectorId` is only forwarded when it looks like a UUID — the schema types
 * it as `z.string().uuid()`, and the wizard's free-text "Inspector ID or name"
 * field could otherwise carry a name that would fail validation.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CreateInspectionJson {
  propertyAddress: string;
  templateId: string;
  date?: string;
  inspectorId?: string;
  serviceIds?: string[];
}

export function buildCreateInspectionJson(formData: FormData): CreateInspectionJson {
  const address = String(formData.get("address") || "");
  const templateId = String(formData.get("templateId") || "");
  const dateStr = String(formData.get("date") || "");
  const time = String(formData.get("time") || "") || "09:00";
  const inspectorId = String(formData.get("inspectorId") || "");
  const serviceIds = String(formData.get("serviceIds") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    propertyAddress: address,
    templateId,
    ...(dateStr ? { date: `${dateStr}T${time}:00Z` } : {}),
    ...(inspectorId && UUID_RE.test(inspectorId) ? { inspectorId } : {}),
    ...(serviceIds.length > 0 ? { serviceIds } : {}),
  };
}
