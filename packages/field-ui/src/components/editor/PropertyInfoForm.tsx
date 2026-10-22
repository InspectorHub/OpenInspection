import { useMemo, useCallback, useEffect, useRef, useState } from "react";
import { pendingProps, PENDING_CLASS } from "@core/shared-ui";
import { isIgnored, useFieldCommand } from "../../context";
import { isDedicatedFactKey } from "../../shared/property-facts-keys";
import { m } from "../../i18n";

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
function residentialFields(): MetadataField[] {
  return [
    { id: "yearBuilt", label: m.editor_property_field_year_built(), type: "number", group: m.editor_property_group_facts() },
    { id: "sqft", label: m.editor_property_field_sqft(), type: "number", group: m.editor_property_group_facts() },
    { id: "foundationType", label: m.editor_property_field_foundation(), type: "select", group: m.editor_property_group_facts(), options: ["basement", "slab", "crawlspace", "other"] },
    { id: "lotSize", label: m.editor_property_field_lot_size(), type: "text", group: m.editor_property_group_facts() },
    { id: "bedrooms", label: m.editor_property_field_bedrooms(), type: "number", group: m.editor_property_group_facts() },
    { id: "bathrooms", label: m.editor_property_field_bathrooms(), type: "number", group: m.editor_property_group_facts() },
    { id: "unit", label: m.editor_property_field_unit(), type: "text", group: m.editor_property_group_facts() },
    { id: "county", label: m.editor_property_field_county(), type: "text", group: m.editor_property_group_facts() },
  ];
}

// Commercial PCA inspections have no bedroom/bathroom counts; `sqft` reads as
// gross building area rather than a home's living area. A commercial property has
// a county but not a unit/suite, so `county` is present and `unit` is not.
function commercialFields(): MetadataField[] {
  return [
    { id: "yearBuilt", label: m.editor_property_field_year_built(), type: "number", group: m.editor_property_group_facts() },
    { id: "sqft", label: m.editor_property_field_building_area(), type: "number", group: m.editor_property_group_facts() },
    { id: "foundationType", label: m.editor_property_field_foundation(), type: "select", group: m.editor_property_group_facts(), options: ["basement", "slab", "crawlspace", "other"] },
    { id: "lotSize", label: m.editor_property_field_lot_size(), type: "text", group: m.editor_property_group_facts() },
    { id: "county", label: m.editor_property_field_county(), type: "text", group: m.editor_property_group_facts() },
  ];
}

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
  // (not a single field), so the parent can persist it through ONE
  // latest-wins channel without losing a field: each PATCH is a superset of
  // any earlier one, so replacing a queued older snapshot with the newest
  // loses nothing. The parent wires this to the `save-property-facts` command.
  onCommit?: (facts: Record<string, unknown>) => void;
}

export function PropertyInfoForm({ inspection, templateFields, propertyAddress, onSave, onCommit }: PropertyInfoFormProps) {
  const defaultFields = inspection.propertyType === "commercial" ? commercialFields() : residentialFields();
  const metaFields = templateFields?.length ? templateFields : defaultFields;

  const filled = useMemo(() => metaFields.filter((f) => inspection[f.id]).length, [metaFields, inspection]);

  const groups = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const f of metaFields) {
      const g = f.group || m.editor_property_group_general();
      if (!seen.has(g)) { seen.add(g); result.push(g); }
    }
    return result;
  }, [metaFields]);

  const fieldsByGroup = useCallback(
    (group: string) => metaFields.filter((f) => (f.group || m.editor_property_group_general()) === group),
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

  // #200 — "Fetch property details": pull public-records facts for the address
  // and fill ONLY the fields the inspector hasn't already entered, so a lookup
  // never clobbers manual work. Rides the data source's `autofill-property-facts`
  // command, then commits the merged snapshot through the same
  // save-property-facts path as manual edits.
  //
  // Each lookup is a billed public-records call, so a same-frame repeat must not issue a second one;
  // pendingProps only goes inert after the render. `useFieldCommand` is the guard: it drops the repeat.
  const { run, busy: autofilling } = useFieldCommand(String(inspection.id));
  const [autofillMsg, setAutofillMsg] = useState<string | null>(null);
  const addressString = (propertyAddress || (inspection.propertyAddress as string) || "").trim();

  // The answer is merged against the form as it is when the answer ARRIVES, not as it was when the
  // button was pressed: the inspector may have typed into a field meanwhile, and a lookup must not
  // overwrite it. (The fetcher effect this replaced read its props fresh at fire time for the same reason.)
  const latest = useRef({ metaFields, inspection, onSave, onCommit });
  latest.current = { metaFields, inspection, onSave, onCommit };
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  function applyAutofill(facts: Record<string, unknown> | null, reason: string | null) {
    const { metaFields: fields, inspection: current, onSave: save, onCommit: commit } = latest.current;
    if (!facts) {
      setAutofillMsg(
        reason === "NO_API_KEY"
          ? m.editor_property_autofill_unconfigured()
          : reason === "NOT_FOUND"
            ? m.editor_property_autofill_not_found()
            : m.editor_property_autofill_failed(),
      );
      return;
    }

    const dedicated: Record<string, unknown> = {};
    const metadata: Record<string, unknown> = {};
    const filledLabels: string[] = [];
    for (const f of fields) {
      const existing = current[f.id];
      const isEmpty = existing === "" || existing === null || existing === undefined;
      const factVal = facts[f.id];
      let raw = existing;
      if (isEmpty && factVal != null && factVal !== "") {
        raw = factVal;
        filledLabels.push(f.label);
        save?.(f.id, factVal); // optimistic — keep the controlled input in sync
      }
      const value = coerce(f, raw);
      if (isDedicatedFactKey(f.id)) dedicated[f.id] = value;
      else metadata[f.id] = value;
    }

    if (filledLabels.length) {
      commit?.(Object.keys(metadata).length ? { ...dedicated, metadata } : dedicated);
      setAutofillMsg(
        m.editor_property_autofill_filled({ count: filledLabels.length, fields: filledLabels.join(", ") }),
      );
    } else {
      setAutofillMsg(m.editor_property_autofill_none());
    }
  }

  async function runAutofill() {
    setAutofillMsg(null);
    const answer = await run({ type: "autofill-property-facts", addressString });
    // A dropped repeat sent nothing and the first request is still running: it is neither an answer nor a failure.
    // After an unmount there is no form left to fill.
    if (isIgnored(answer) || !mounted.current) return;
    // The lookup's reason rides on BOTH outcomes; no data at all means the request never got an answer
    // (offline, expired session), which the fetcher showed as nothing, and so does this.
    if (answer.data) applyAutofill(answer.data.facts, answer.data.reason);
  }

  return (
    <div className="px-6 py-6 max-w-5xl" data-testid="property-info-form">
      <header className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3">
            {m.editor_property_progress({ filled, total: metaFields.length })}
          </p>
          {filled === metaFields.length && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-ih-ok-bg text-ih-ok-fg ring-1 ring-inset ring-ih-ok/30">
              {m.editor_property_complete()}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-2xl font-bold tracking-tight text-ih-fg-1">
            {(propertyAddress || inspection.propertyAddress as string) || m.editor_property_fallback()}
          </h2>
          <button
            type="button"
            // Only the in-flight part is aria-disabled (focus stays on the button); too-short stays native.
            {...pendingProps(autofilling, () => void runAutofill())}
            disabled={addressString.length < 5}
            className={`h-8 px-3 rounded-md border border-ih-border text-[12px] font-bold text-ih-primary-text hover:bg-ih-primary-tint disabled:opacity-50 disabled:cursor-not-allowed ${PENDING_CLASS}`}
          >
            {autofilling ? m.editor_property_autofill_loading() : m.editor_property_autofill_button()}
          </button>
        </div>
        {autofillMsg && <p className="mt-2 text-[12px] text-ih-fg-3">{autofillMsg}</p>}
      </header>

      {groups.map((g) => (
        <fieldset key={g} className="mb-6">
          <legend className="text-[11px] font-bold uppercase tracking-[0.15em] text-ih-fg-3 mb-2">{g}</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {fieldsByGroup(g).map((f) => (
              <label key={f.id} className="block">
                <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.18em] text-ih-fg-3">
                  <span>{f.label}</span>
                  {Boolean(inspection[`_prefilled_${f.id}`]) && (
                    <span className="text-[9px] font-semibold text-ih-primary-text normal-case tracking-normal">{m.editor_property_prefilled()}</span>
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
