import { useMemo, useCallback } from "react";
import { isDedicatedFactKey } from "~/lib/property-facts-keys";

interface MetadataField {
  id: string;
  label: string;
  type: "text" | "number" | "date" | "select" | "boolean";
  group?: string;
  options?: string[];
  unit?: string;
}

// Field ids here MUST be persistable keys of PropertyFactsSchema
// (server/lib/validations/inspection/read.ts): yearBuilt, sqft, foundationType,
// lotSize, bedrooms, bathrooms, unit, county. `reportTier`/`commercialSubtype`
// are owned by CommercialReportControls, not this form. `unit`/`county` are real
// text columns on `inspections` (autofilled at intake) and are now in
// PropertyFactsSchema, so edits here persist through the property-facts write.
const RESIDENTIAL_FIELDS: MetadataField[] = [
  { id: "yearBuilt", label: "Year Built", type: "number", group: "Property facts" },
  { id: "sqft", label: "Sq Ft", type: "number", group: "Property facts" },
  { id: "foundationType", label: "Foundation", type: "select", group: "Property facts", options: ["basement", "slab", "crawlspace", "other"] },
  { id: "lotSize", label: "Lot Size", type: "text", group: "Property facts" },
  { id: "bedrooms", label: "Bedrooms", type: "number", group: "Property facts" },
  { id: "bathrooms", label: "Bathrooms", type: "number", group: "Property facts" },
  { id: "unit", label: "Unit / Suite", type: "text", group: "Property facts" },
  { id: "county", label: "County", type: "text", group: "Property facts" },
];

// Commercial PCA inspections have no bedroom/bathroom counts; `sqft` reads as
// gross building area rather than a home's living area. A commercial property has
// a county but not a unit/suite, so `county` is present and `unit` is not.
const COMMERCIAL_FIELDS: MetadataField[] = [
  { id: "yearBuilt", label: "Year Built", type: "number", group: "Property facts" },
  { id: "sqft", label: "Building Area (Sq Ft)", type: "number", group: "Property facts" },
  { id: "foundationType", label: "Foundation", type: "select", group: "Property facts", options: ["basement", "slab", "crawlspace", "other"] },
  { id: "lotSize", label: "Lot Size", type: "text", group: "Property facts" },
  { id: "county", label: "County", type: "text", group: "Property facts" },
];

interface PropertyInfoFormProps {
  inspection: Record<string, unknown>;
  templateFields?: MetadataField[];
  propertyAddress?: string;
  // Optimistic, per-keystroke update for the parent's local state. Stores the
  // RAW value typed (a string for text/number/date, a boolean for checkboxes),
  // so the controlled input keeps exactly what the inspector typed — including a
  // transient "2." mid-decimal. Does NOT persist on its own.
  onSave?: (fieldId: string, value: unknown) => void;
  // Durable save. Fires on blur for text/number/date, on change for
  // select/boolean (discrete). Receives a FULL coerced snapshot of every field
  // (not a single field), so the parent can persist it through ONE shared
  // fetcher without field-to-field abort: each PATCH is a superset of any
  // in-flight one (mirrors PsqPanel.commitResponses; see
  // feedback_rr_shared_fetcher_abort). The parent wires this to the
  // `save-property-facts` route intent.
  onCommit?: (facts: Record<string, unknown>) => void;
}

export function PropertyInfoForm({ inspection, templateFields, propertyAddress, onSave, onCommit }: PropertyInfoFormProps) {
  const defaultFields = inspection.propertyType === "commercial" ? COMMERCIAL_FIELDS : RESIDENTIAL_FIELDS;
  const metaFields = templateFields?.length ? templateFields : defaultFields;

  const filled = useMemo(() => metaFields.filter((f) => inspection[f.id]).length, [metaFields, inspection]);

  const groups = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const f of metaFields) {
      const g = f.group || "General";
      if (!seen.has(g)) { seen.add(g); result.push(g); }
    }
    return result;
  }, [metaFields]);

  const fieldsByGroup = useCallback(
    (group: string) => metaFields.filter((f) => (f.group || "General") === group),
    [metaFields],
  );

  // Coerce a field's CURRENT value into the shape PropertyFactsSchema expects.
  // Only ever runs on the commit path (never per-keystroke), so a transient
  // "2." never gets coerced back into the controlled input mid-typing.
  //   number  → empty/null/undefined → null, else Number() (decimals allowed)
  //   text/date/select → empty/null/undefined → null, else String()
  //   boolean → Boolean()
  // The value passed in is the raw string the input holds (or a boolean for
  // checkboxes); the server Zod validates ranges after this.
  function coerce(field: MetadataField, value: unknown): unknown {
    if (field.type === "boolean") return Boolean(value);
    if (value === "" || value === null || value === undefined) return null;
    if (field.type === "number") return Number(value);
    return String(value);
  }

  // Durable commit. Builds a FULL coerced snapshot of every field in metaFields:
  // the changed field takes its just-entered value; every other field is read
  // from the `inspection` prop (which the optimistic onSave has already
  // updated). Committing the whole object each time is what makes a single
  // shared fetcher abort-safe — a later PATCH is a superset of any in-flight
  // one, so a cancelled earlier submit loses no data.
  // Dedicated-column keys (yearBuilt, sqft, ...) go at the top level where the
  // service writes them to real columns; every other field is a commercial
  // subtype-preset extra (nra, floorCount, sprinklered, ...) that rides the
  // `metadata` envelope into the property_facts JSON column. The split is keyed
  // off the single shared DEDICATED_FACT_KEYS list. When the active preset has
  // no non-dedicated fields (every residential preset), `metadata` stays empty
  // and we emit a flat object — byte-for-byte the pre-envelope shape, so the
  // strip's superset-PATCH abort-safety and existing callers are unchanged.
  function commitAll(changedField: MetadataField, changedValue: unknown) {
    const dedicated: Record<string, unknown> = {};
    const metadata: Record<string, unknown> = {};
    for (const f of metaFields) {
      const raw = f.id === changedField.id ? changedValue : inspection[f.id];
      const value = coerce(f, raw);
      if (isDedicatedFactKey(f.id)) dedicated[f.id] = value;
      else metadata[f.id] = value;
    }
    onCommit?.(Object.keys(metadata).length ? { ...dedicated, metadata } : dedicated);
  }

  return (
    <div className="px-6 py-6 max-w-5xl" data-testid="property-info-form">
      <header className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-4">
            Property Info &middot; {filled} of {metaFields.length} fields complete
          </p>
          {filled === metaFields.length && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-ih-ok-bg text-ih-ok-fg ring-1 ring-inset ring-ih-ok/30">
              Complete
            </span>
          )}
        </div>
        <h2 className="text-2xl font-bold tracking-tight text-ih-fg-1">
          {(propertyAddress || inspection.propertyAddress as string) || "Property Info"}
        </h2>
      </header>

      {groups.map((g) => (
        <fieldset key={g} className="mb-6">
          <legend className="text-[11px] font-bold uppercase tracking-[0.15em] text-ih-fg-4 mb-2">{g}</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {fieldsByGroup(g).map((f) => (
              <label key={f.id} className="block">
                <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.18em] text-ih-fg-3">
                  <span>{f.label}</span>
                  {Boolean(inspection[`_prefilled_${f.id}`]) && (
                    <span className="text-[9px] font-semibold text-ih-primary normal-case tracking-normal">Prefilled</span>
                  )}
                </span>
                {(f.type === "text" || f.type === "number" || f.type === "date") && (
                  <input
                    type={f.type}
                    value={(inspection[f.id] as string | number) ?? ""}
                    onChange={(e) => onSave?.(f.id, e.target.value)}
                    onBlur={(e) => commitAll(f, e.target.value)}
                    placeholder={f.unit ?? "—"}
                    className="ih-input mt-1 w-full"
                  />
                )}
                {f.type === "select" && (
                  <select
                    value={(inspection[f.id] as string) ?? ""}
                    onChange={(e) => { onSave?.(f.id, e.target.value); commitAll(f, e.target.value); }}
                    className="ih-input mt-1 w-full"
                  >
                    <option value="">&mdash;</option>
                    {(f.options ?? []).map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                )}
                {f.type === "boolean" && (
                  <div className="mt-1 flex items-center h-10">
                    <input
                      type="checkbox"
                      checked={!!inspection[f.id]}
                      onChange={(e) => { onSave?.(f.id, e.target.checked); commitAll(f, e.target.checked); }}
                      className="h-4 w-4 rounded border-ih-border-strong text-ih-primary focus:ring-ih-primary/30"
                    />
                  </div>
                )}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
