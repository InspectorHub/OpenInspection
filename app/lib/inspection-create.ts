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
 *
 * P-4 service price overrides:
 * - `serviceSelectionsJson` carries a JSON array of `{serviceId, priceOverrideCents?}`.
 *   When present, `serviceSelections` is forwarded to the API; the legacy `serviceIds`
 *   flat list is also emitted for backward compatibility with old callers.
 *   The server-side schema already treats serviceSelections as the superset that takes
 *   precedence over serviceIds when both are present (IA-1 server contract).
 *
 * IA-1 People step fields:
 * - `clientName/clientEmail/clientPhone` → `client{name,email?,phone?}` only
 *   when `clientName` is non-empty (omitting client entirely when no name).
 * - `agentContactId` → forwarded when it is a UUID (existing contact link).
 * - `newAgentName/newAgentEmail` → `newAgent{name,email?}` when `newAgentName`
 *   is non-empty and `agentContactId` is absent. The two are mutually exclusive
 *   in the UI; we enforce the same here: agentContactId wins if both are sent.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Single entry in the serviceSelections payload. */
interface ServiceSelection {
  serviceId: string;
  priceOverrideCents?: number;
}

export interface CreateInspectionJson {
  propertyAddress: string;
  templateId: string;
  // #198 — structured, geocoded address from Places autocomplete. All optional;
  // omitted for hand-typed free-form addresses. The server stamps
  // addressGeocodedAt when addressPlaceId is present.
  addressPlaceId?: string;
  addressStreet?: string;
  addressCity?: string;
  addressState?: string;
  addressZip?: string;
  addressCounty?: string;
  addressLat?: number;
  addressLng?: number;
  date?: string;
  inspectorId?: string;
  /** Legacy flat list — kept for backward compat. */
  serviceIds?: string[];
  /** P-4: Richer list with optional per-row price overrides (superset of serviceIds). */
  serviceSelections?: ServiceSelection[];
  // IA-1 People step
  client?: { name: string; email?: string; phone?: string };
  agentContactId?: string;
  newAgent?: { name: string; email?: string };
}

/**
 * Convert a dollar string (from a number input) to integer cents, avoiding
 * the classic float trap (e.g. "449.99" → 44999, not 44998.999…).
 * Returns undefined when the input is empty/null/NaN.
 */
export function dollarsToCents(value: string | number | null | undefined): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const n = typeof value === 'string' ? parseFloat(value) : value;
  if (!isFinite(n) || n < 0) return undefined;
  return Math.round(n * 100);
}

export function buildCreateInspectionJson(formData: FormData): CreateInspectionJson {
  const address = String(formData.get("address") || "");
  const templateId = String(formData.get("templateId") || "");

  // #198 — structured address fields (present only when a Places suggestion was
  // picked). Empty strings collapse to omitted; lat/lng parse to finite numbers.
  const addressPlaceId = String(formData.get("addressPlaceId") || "").trim();
  const addressStreet = String(formData.get("addressStreet") || "").trim();
  const addressCity = String(formData.get("addressCity") || "").trim();
  const addressState = String(formData.get("addressState") || "").trim();
  const addressZip = String(formData.get("addressZip") || "").trim();
  const addressCounty = String(formData.get("addressCounty") || "").trim();
  const latRaw = String(formData.get("addressLat") || "").trim();
  const lngRaw = String(formData.get("addressLng") || "").trim();
  const addressLat = latRaw ? Number(latRaw) : undefined;
  const addressLng = lngRaw ? Number(lngRaw) : undefined;

  const dateStr = String(formData.get("date") || "");
  const time = String(formData.get("time") || "") || "09:00";
  const inspectorId = String(formData.get("inspectorId") || "");

  // P-4: prefer the richer serviceSelectionsJson when present; fall back to
  // the legacy comma-joined serviceIds string for old callers.
  const serviceSelectionsRaw = String(formData.get("serviceSelectionsJson") || "").trim();
  let serviceSelections: ServiceSelection[] | undefined;
  let serviceIds: string[] | undefined;

  if (serviceSelectionsRaw) {
    try {
      const parsed = JSON.parse(serviceSelectionsRaw) as ServiceSelection[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        serviceSelections = parsed;
        // Emit legacy serviceIds list for backward compat with any old callers
        // that only read that field. The server treats serviceSelections as the
        // authoritative source when both are present.
        serviceIds = parsed.map((s) => s.serviceId);
      }
    } catch {
      // Malformed JSON — fall through to the legacy path.
    }
  }

  if (!serviceIds) {
    const flat = String(formData.get("serviceIds") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (flat.length > 0) serviceIds = flat;
  }

  // IA-1 People step fields
  const clientName = String(formData.get("clientName") || "").trim();
  const clientEmail = String(formData.get("clientEmail") || "").trim();
  const clientPhone = String(formData.get("clientPhone") || "").trim();
  const agentContactId = String(formData.get("agentContactId") || "").trim();
  const newAgentName = String(formData.get("newAgentName") || "").trim();
  const newAgentEmail = String(formData.get("newAgentEmail") || "").trim();

  // Build client object only when a name is provided.
  let client: CreateInspectionJson["client"] | undefined;
  if (clientName) {
    client = { name: clientName };
    if (clientEmail) client.email = clientEmail;
    if (clientPhone) client.phone = clientPhone;
  }

  // agentContactId wins over newAgent when both are somehow present.
  let agentId: string | undefined;
  let newAgent: CreateInspectionJson["newAgent"] | undefined;
  if (agentContactId && UUID_RE.test(agentContactId)) {
    agentId = agentContactId;
  } else if (newAgentName) {
    newAgent = { name: newAgentName };
    if (newAgentEmail) newAgent.email = newAgentEmail;
  }

  return {
    propertyAddress: address,
    templateId,
    ...(addressPlaceId ? { addressPlaceId } : {}),
    ...(addressStreet ? { addressStreet } : {}),
    ...(addressCity ? { addressCity } : {}),
    ...(addressState ? { addressState } : {}),
    ...(addressZip ? { addressZip } : {}),
    ...(addressCounty ? { addressCounty } : {}),
    ...(addressLat != null && Number.isFinite(addressLat) ? { addressLat } : {}),
    ...(addressLng != null && Number.isFinite(addressLng) ? { addressLng } : {}),
    ...(dateStr ? { date: `${dateStr}T${time}:00Z` } : {}),
    ...(inspectorId && UUID_RE.test(inspectorId) ? { inspectorId } : {}),
    ...(serviceIds ? { serviceIds } : {}),
    ...(serviceSelections ? { serviceSelections } : {}),
    ...(client ? { client } : {}),
    ...(agentId ? { agentContactId: agentId } : {}),
    ...(newAgent ? { newAgent } : {}),
  };
}
