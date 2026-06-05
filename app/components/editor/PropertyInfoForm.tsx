import { useMemo, useCallback } from "react";

interface MetadataField {
 id: string;
 label: string;
 type: "text" | "number" | "date" | "select" | "boolean";
 group?: string;
 options?: string[];
 unit?: string;
}

const DEFAULT_FIELDS: MetadataField[] = [
 { id: "yearBuilt", label: "Year Built", type: "number", group: "Property facts" },
 { id: "sqft", label: "Sq Ft", type: "number", group: "Property facts" },
 { id: "foundationType", label: "Foundation", type: "select", group: "Property facts", options: ["basement", "slab", "crawlspace", "other"] },
 { id: "bedrooms", label: "Bedrooms", type: "number", group: "Property facts" },
 { id: "bathrooms", label: "Bathrooms", type: "number", group: "Property facts" },
 { id: "unit", label: "Unit", type: "text", group: "Property facts" },
 { id: "county", label: "County", type: "text", group: "Property facts" },
];

interface PropertyInfoFormProps {
 inspection: Record<string, unknown>;
 templateFields?: MetadataField[];
 propertyAddress?: string;
 onSave?: (fieldId: string, value: unknown) => void;
}

export function PropertyInfoForm({ inspection, templateFields, propertyAddress, onSave }: PropertyInfoFormProps) {
 const metaFields = templateFields?.length ? templateFields : DEFAULT_FIELDS;

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

 function handleChange(field: MetadataField, value: unknown) {
 onSave?.(field.id, value);
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
 value={(inspection[f.id] as string) ?? ""}
 onChange={(e) => handleChange(f, f.type === "number" ? Number(e.target.value) : e.target.value)}
 placeholder={f.unit ?? "—"}
 className="ih-input mt-1 w-full"
 />
 )}
 {f.type === "select" && (
 <select
 value={(inspection[f.id] as string) ?? ""}
 onChange={(e) => handleChange(f, e.target.value)}
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
 onChange={(e) => handleChange(f, e.target.checked)}
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
