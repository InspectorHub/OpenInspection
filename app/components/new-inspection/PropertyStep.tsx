import type { WizardTemplate } from "../NewInspectionWizard";
import { m } from "~/paraglide/messages";

// `label` is a thunk so each type name resolves at render inside the paraglide
// request scope, not once at module import.
const PROPERTY_TYPES = [
  { value: "single_family", label: () => m.newinsp_property_type_single_family() },
  { value: "multi_unit", label: () => m.newinsp_property_type_multi_unit() },
  { value: "commercial", label: () => m.newinsp_property_type_commercial() },
] as const;

export function PropertyStep({
  propertyType,
  setPropertyType,
  address,
  setAddress,
  templates,
  templateId,
  setTemplateId,
  templateQuery,
  setTemplateQuery,
  filteredTemplates,
  selectedTemplate,
}: {
  propertyType: string;
  setPropertyType: (v: string) => void;
  address: string;
  setAddress: (v: string) => void;
  templates: WizardTemplate[];
  templateId: string;
  setTemplateId: (v: string) => void;
  templateQuery: string;
  setTemplateQuery: (v: string) => void;
  filteredTemplates: WizardTemplate[];
  selectedTemplate: WizardTemplate | undefined;
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-[12px] font-bold text-ih-fg-3 mb-1.5">{m.newinsp_property_type_label()}</label>
        <div className="flex gap-2">
          {PROPERTY_TYPES.map((pt) => (
            <button key={pt.value} onClick={() => setPropertyType(pt.value)}
              className={`flex-1 py-2 rounded-md text-[12px] font-bold border transition-colors ${propertyType === pt.value ? "border-ih-primary bg-ih-primary-tint text-ih-primary" : "border-ih-border text-ih-fg-3"}`}
            >{pt.label()}</button>
          ))}
        </div>
      </div>
      <div>
        <label className="block text-[12px] font-bold text-ih-fg-3 mb-1.5">{m.newinsp_property_address_label()}</label>
        <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder={m.newinsp_property_address_ph()} className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] focus:shadow-ih-focus outline-none" />
      </div>
      <div>
        <label className="block text-[12px] font-bold text-ih-fg-3 mb-1.5">{m.newinsp_property_template_label()}</label>
        {templates.length === 0 ? (
          <p className="text-[12px] text-ih-fg-4 px-1 py-2">
            {m.newinsp_property_no_templates()}
          </p>
        ) : (
          <>
            {templates.length > 6 && (
              <input
                value={templateQuery}
                onChange={(e) => setTemplateQuery(e.target.value)}
                placeholder={m.newinsp_property_filter_ph()}
                className="w-full h-9 px-3 mb-2 rounded-md border border-ih-border bg-ih-bg-card text-[13px] focus:shadow-ih-focus outline-none placeholder:text-ih-fg-4"
              />
            )}
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] focus:shadow-ih-focus outline-none"
            >
              <option value="">{m.newinsp_property_select_option()}</option>
              {filteredTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {typeof t.itemCount === "number" ? ` (${t.itemCount} item${t.itemCount === 1 ? "" : "s"})` : ""}
                </option>
              ))}
            </select>
            {templateQuery && filteredTemplates.length === 0 && (
              <p className="text-[12px] text-ih-fg-4 mt-1">{m.newinsp_property_no_match({ query: templateQuery })}</p>
            )}
            {selectedTemplate && (
              <p className="text-[12px] text-ih-fg-4 mt-1">
                {m.newinsp_property_selected({ name: selectedTemplate.name })}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
