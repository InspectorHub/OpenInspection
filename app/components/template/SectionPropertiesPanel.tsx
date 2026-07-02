import { PLATFORM_SUBTYPES } from "../../../server/lib/commercial-subtypes";
import { PROPERTY_TYPE_OPTIONS } from "./types";
import type { PropertyType, TemplateSection } from "./types";
import { toggleInArray, normalizeApplicability } from "~/lib/editor/template-meta";

export interface SectionPropertiesPanelProps {
  section: TemplateSection;
  templatePropertyType?: PropertyType;
  updateSection: (patch: Partial<TemplateSection>) => void;
}

export function SectionPropertiesPanel({ section, templatePropertyType, updateSection }: SectionPropertiesPanelProps) {
  const selectedTypes = section.applicableTo?.propertyTypes ?? [];
  const selectedSubs = section.applicableTo?.commercialSubtypes ?? [];
  const showSubtypes = templatePropertyType === "commercial" || selectedTypes.includes("commercial");

  function setPropertyType(pt: PropertyType, on: boolean) {
    const propertyTypes = toggleInArray(selectedTypes, pt, on);
    updateSection({ applicableTo: normalizeApplicability({ propertyTypes, commercialSubtypes: selectedSubs }) });
  }
  function setSubtype(id: string, on: boolean) {
    const commercialSubtypes = toggleInArray(selectedSubs, id, on);
    updateSection({ applicableTo: normalizeApplicability({ propertyTypes: selectedTypes, commercialSubtypes }) });
  }

  return (
    <div className="space-y-3" data-testid="section-properties-panel">
      <div>
        <span className="block text-[10px] font-bold uppercase tracking-widest text-ih-fg-4 mb-1">Applies to property types</span>
        <p className="text-[11px] text-ih-fg-4 mb-1">Leave all unchecked to apply to every property type.</p>
        {PROPERTY_TYPE_OPTIONS.map((p) => (
          <label key={p.value} className="flex items-center gap-2">
            <input
              type="checkbox"
              data-testid={`applies-pt-${p.value}`}
              checked={selectedTypes.includes(p.value)}
              onChange={(e) => setPropertyType(p.value, e.target.checked)}
              className="accent-ih-primary"
            />
            <span className="text-[12px] text-ih-fg-3">{p.label}</span>
          </label>
        ))}
      </div>

      {showSubtypes && (
        <div>
          <span className="block text-[10px] font-bold uppercase tracking-widest text-ih-fg-4 mb-1">Applies to commercial subtypes</span>
          <p className="text-[11px] text-ih-fg-4 mb-1">Leave all unchecked to apply to every commercial subtype.</p>
          {PLATFORM_SUBTYPES.map((s) => (
            <label key={s.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                data-testid={`applies-sub-${s.id}`}
                checked={selectedSubs.includes(s.id)}
                onChange={(e) => setSubtype(s.id, e.target.checked)}
                className="accent-ih-primary"
              />
              <span className="text-[12px] text-ih-fg-3">{s.label}</span>
            </label>
          ))}
        </div>
      )}

      <div>
        <span className="block text-[10px] font-bold uppercase tracking-widest text-ih-fg-4 mb-1">Default scope</span>
        <p className="text-[11px] text-ih-fg-4 mb-1">Unit sections repeat per unit in per-unit inspections (Phase U).</p>
        {(["common", "unit"] as const).map((scope) => (
          <label key={scope} className="flex items-center gap-2">
            <input
              type="radio"
              name={`scope-${section.id}`}
              data-testid={`scope-${scope}`}
              checked={(section.defaultScope ?? "common") === scope}
              onChange={() => updateSection({ defaultScope: scope })}
              className="accent-ih-primary"
            />
            <span className="text-[12px] text-ih-fg-3 capitalize">{scope}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
