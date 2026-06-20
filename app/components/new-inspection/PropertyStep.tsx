import type { WizardTemplate } from "../NewInspectionWizard";

const PROPERTY_TYPES = [
  { value: "single_family", label: "Single Family" },
  { value: "multi_unit", label: "Multi-Unit" },
  { value: "commercial", label: "Commercial" },
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
        <label className="block text-[12px] font-bold text-ih-fg-3 mb-1.5">Property Type</label>
        <div className="flex gap-2">
          {PROPERTY_TYPES.map((pt) => (
            <button key={pt.value} onClick={() => setPropertyType(pt.value)}
              className={`flex-1 py-2 rounded-md text-[12px] font-bold border transition-colors ${propertyType === pt.value ? "border-ih-primary bg-ih-primary-tint text-ih-primary" : "border-ih-border text-ih-fg-3"}`}
            >{pt.label}</button>
          ))}
        </div>
      </div>
      <div>
        <label className="block text-[12px] font-bold text-ih-fg-3 mb-1.5">Address</label>
        <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="123 Main St, City, State" className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] focus:shadow-ih-focus outline-none" />
      </div>
      <div>
        <label className="block text-[12px] font-bold text-ih-fg-3 mb-1.5">Template</label>
        {templates.length === 0 ? (
          <p className="text-[12px] text-ih-fg-4 px-1 py-2">
            No templates yet — create one under Templates first.
          </p>
        ) : (
          <>
            {templates.length > 6 && (
              <input
                value={templateQuery}
                onChange={(e) => setTemplateQuery(e.target.value)}
                placeholder="Type to filter templates…"
                className="w-full h-9 px-3 mb-2 rounded-md border border-ih-border bg-ih-bg-card text-[13px] focus:shadow-ih-focus outline-none placeholder:text-ih-fg-4"
              />
            )}
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] focus:shadow-ih-focus outline-none"
            >
              <option value="">Select a template…</option>
              {filteredTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {typeof t.itemCount === "number" ? ` (${t.itemCount} item${t.itemCount === 1 ? "" : "s"})` : ""}
                </option>
              ))}
            </select>
            {templateQuery && filteredTemplates.length === 0 && (
              <p className="text-[12px] text-ih-fg-4 mt-1">No templates match “{templateQuery}”.</p>
            )}
            {selectedTemplate && (
              <p className="text-[12px] text-ih-fg-4 mt-1">
                Selected: {selectedTemplate.name}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
