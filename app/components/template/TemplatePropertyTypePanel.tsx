import { PLATFORM_SUBTYPES } from "../../../server/lib/commercial-subtypes";
import { PROPERTY_TYPE_OPTIONS } from "./types";
import type { PropertyType } from "./types";

export interface TemplatePropertyTypePanelProps {
  propertyType?: PropertyType;
  commercialSubtype?: string;
  onChange: (patch: { propertyType?: PropertyType; commercialSubtype?: string }) => void;
}

export function TemplatePropertyTypePanel({ propertyType, commercialSubtype, onChange }: TemplatePropertyTypePanelProps) {
  const isCommercial = propertyType === "commercial";
  return (
    <div className="flex items-center gap-4" data-testid="template-property-type-panel">
      <label className="flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">Property type</span>
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
          <option value="">Unspecified (single-family)</option>
          {PROPERTY_TYPE_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </label>
      {isCommercial && (
        <label className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">Subtype</span>
          <select
            data-testid="template-commercial-subtype"
            value={commercialSubtype ?? ""}
            onChange={(e) => onChange({ propertyType, commercialSubtype: e.target.value || undefined })}
            className="h-7 px-2 rounded border border-ih-border text-[12px] bg-transparent outline-none text-ih-fg-2"
          >
            <option value="">All commercial</option>
            {PLATFORM_SUBTYPES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}
