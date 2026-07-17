import { PLATFORM_SUBTYPES } from "../../../server/lib/commercial-subtypes";
import { PROPERTY_TYPE_OPTIONS } from "./types";
import type { PropertyType } from "./types";
import { m } from "~/paraglide/messages";

export interface TemplatePropertyTypePanelProps {
  propertyType?: PropertyType;
  commercialSubtype?: string;
  onChange: (patch: { propertyType?: PropertyType; commercialSubtype?: string }) => void;
}

// Resolve a property-type value to its display label at render time, so the
// user-facing label is never frozen at import from the module-level const.
function propertyTypeLabel(value: PropertyType): string {
  if (value === "single-family") return m.templates_property_type_single_family();
  if (value === "multi-unit") return m.templates_property_type_multi_unit();
  return m.templates_property_type_commercial();
}

export function TemplatePropertyTypePanel({ propertyType, commercialSubtype, onChange }: TemplatePropertyTypePanelProps) {
  const isCommercial = propertyType === "commercial";
  return (
    <div className="flex items-center gap-4" data-testid="template-property-type-panel">
      <label className="flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">{m.templates_property_type_label()}</span>
        <select
          data-testid="template-property-type"
          value={propertyType ?? ""}
          onChange={(e) => {
            const next = (e.target.value || undefined) as PropertyType | undefined;
            // Clearing commercial drops the now-meaningless subtype.
            onChange({ propertyType: next, commercialSubtype: next === "commercial" ? commercialSubtype : undefined });
          }}
          className="h-7 px-2 rounded border border-ih-border text-[12px] bg-transparent outline-none text-ih-fg-2"
        >
          <option value="">{m.templates_property_type_unspecified()}</option>
          {PROPERTY_TYPE_OPTIONS.map((p) => <option key={p.value} value={p.value}>{propertyTypeLabel(p.value)}</option>)}
        </select>
      </label>
      {isCommercial && (
        <label className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">{m.templates_subtype_label()}</span>
          <select
            data-testid="template-commercial-subtype"
            value={commercialSubtype ?? ""}
            onChange={(e) => onChange({ propertyType, commercialSubtype: e.target.value || undefined })}
            className="h-7 px-2 rounded border border-ih-border text-[12px] bg-transparent outline-none text-ih-fg-2"
          >
            <option value="">{m.templates_subtype_all()}</option>
            {PLATFORM_SUBTYPES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}
