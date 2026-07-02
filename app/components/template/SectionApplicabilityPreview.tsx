import { useState } from "react";
import { sectionApplies } from "../../../server/lib/section-applicability";
import type { TemplateSection } from "../../../server/types/template-schema";
import { PLATFORM_SUBTYPES } from "../../../server/lib/commercial-subtypes";
import { PROPERTY_TYPE_OPTIONS } from "./types";
import type { PropertyType } from "./types";

export interface SectionApplicabilityPreviewProps {
  sections: TemplateSection[];
  initialPropertyType?: string;
  initialCommercialSubtype?: string;
}

export function SectionApplicabilityPreview({ sections, initialPropertyType, initialCommercialSubtype }: SectionApplicabilityPreviewProps) {
  const [propertyType, setPropertyType] = useState<string>(initialPropertyType || "single-family");
  const [subtype, setSubtype] = useState<string>(initialCommercialSubtype || "");
  const isCommercial = propertyType === "commercial";

  return (
    <div className="space-y-2" data-testid="applicability-preview">
      <div className="flex items-center gap-2">
        <select
          data-testid="preview-property-type"
          value={propertyType}
          onChange={(e) => setPropertyType(e.target.value)}
          className="h-7 px-2 rounded border border-ih-border text-[12px] bg-transparent outline-none text-ih-fg-2"
        >
          {PROPERTY_TYPE_OPTIONS.map((p: { value: PropertyType; label: string }) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
        {isCommercial && (
          <select
            data-testid="preview-subtype"
            value={subtype}
            onChange={(e) => setSubtype(e.target.value)}
            className="h-7 px-2 rounded border border-ih-border text-[12px] bg-transparent outline-none text-ih-fg-2"
          >
            <option value="">All commercial</option>
            {PLATFORM_SUBTYPES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        )}
      </div>

      <div className="space-y-0.5">
        {sections.map((s) => {
          const applies = sectionApplies(s, propertyType, isCommercial && subtype ? subtype : null);
          return (
            <div
              key={s.id}
              data-section-id={s.id}
              data-applies={applies ? "1" : "0"}
              className="flex items-center justify-between text-[12px]"
            >
              <span className="truncate text-ih-fg-3">{s.title}</span>
              <span className={applies ? "text-ih-ok-fg font-bold" : "text-ih-fg-4"}>{applies ? "Applies" : "Hidden"}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
