import { useEffect, useMemo, useState } from "react";
import { useFetcher } from "react-router";

const STEPS = ["Property", "Services", "Schedule", "Team"] as const;

const PROPERTY_TYPES = [
  { value: "single_family", label: "Single Family" },
  { value: "multi_unit", label: "Multi-Unit" },
  { value: "commercial", label: "Commercial" },
] as const;

export interface WizardTemplate {
  id: string;
  name: string;
  itemCount?: number;
}

export interface WizardService {
  id: string;
  name: string;
  price?: number | null;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function NewInspectionWizard({
  open,
  onClose,
  templates = [],
  services: serviceCatalog = [],
}: {
  open: boolean;
  onClose: () => void;
  templates?: WizardTemplate[];
  services?: WizardService[];
}) {
  const fetcher = useFetcher();
  const [step, setStep] = useState(0);
  const [propertyType, setPropertyType] = useState("single_family");
  const [address, setAddress] = useState("");
  const [templateId, setTemplateId] = useState("");
  // Stores selected service IDs (matched against the tenant's services table).
  const [services, setServices] = useState<Set<string>>(new Set());
  const [date, setDate] = useState("");
  const [time, setTime] = useState("09:00");
  const [soloMode, setSoloMode] = useState(true);
  const [inspectorId, setInspectorId] = useState("");

  const hasServiceCatalog = serviceCatalog.length > 0;

  // Typeahead filter for the template picker (B-6).
  const [templateQuery, setTemplateQuery] = useState("");
  const filteredTemplates = useMemo(() => {
    const q = templateQuery.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter((t) => t.name.toLowerCase().includes(q));
  }, [templates, templateQuery]);
  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === templateId),
    [templates, templateId],
  );

  useEffect(() => {
    if (open) return;
    setStep(0);
    setPropertyType("single_family");
    setAddress("");
    setTemplateId("");
    setTemplateQuery("");
    setServices(new Set());
    setDate("");
    setTime("09:00");
    setSoloMode(true);
    setInspectorId("");
  }, [open]);

  if (!open) return null;

  const toggleService = (id: string) =>
    setServices((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });

  const canNext =
    // propertyAddress has a min(5) server constraint — enforce it here so the
    // wizard cannot advance into an inevitable 400.
    step === 0 ? address.trim().length >= 5 && templateId.length > 0 :
    // Services are optional when the tenant has no service catalog configured;
    // otherwise require at least one so the inspection is meaningful.
    step === 1 ? (!hasServiceCatalog || services.size > 0) :
    step === 2 ? date.length > 0 :
    true;

  function handleSubmit() {
    fetcher.submit(
      {
        intent: "create",
        propertyType,
        address,
        templateId,
        serviceIds: [...services].join(","),
        date,
        time,
        soloMode: String(soloMode),
        inspectorId,
      },
      { method: "post", action: "/dashboard" },
    );
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg bg-ih-bg-card rounded-xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-ih-border">
          <h2 className="text-[16px] font-bold">New Inspection</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-lg leading-none">&times;</button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-1 px-6 pt-4">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-1 flex-1">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold ${i <= step ? "bg-ih-primary text-white" : "bg-slate-200 dark:bg-slate-700 text-slate-400"}`}>{i + 1}</div>
              <span className={`text-[11px] font-medium hidden sm:inline ${i <= step ? "text-ih-primary" : "text-slate-400"}`}>{s}</span>
              {i < STEPS.length - 1 && <div className={`flex-1 h-px mx-1 ${i < step ? "bg-ih-primary" : "bg-slate-200 dark:bg-slate-700"}`} />}
            </div>
          ))}
        </div>

        {/* Body */}
        <div className="px-6 py-5 min-h-[220px]">
          {step === 0 && (
            <div className="space-y-4">
              <div>
                <label className="block text-[12px] font-bold text-ih-fg-3 mb-1.5">Property Type</label>
                <div className="flex gap-2">
                  {PROPERTY_TYPES.map((pt) => (
                    <button key={pt.value} onClick={() => setPropertyType(pt.value)}
                      className={`flex-1 py-2 rounded-md text-[12px] font-bold border transition-colors ${propertyType === pt.value ? "border-indigo-600 bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400" : "border-ih-border text-ih-fg-3"}`}
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
                        placeholder="Search templates…"
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
                      <p className="text-[11px] text-ih-fg-4 mt-1">No templates match “{templateQuery}”.</p>
                    )}
                    {selectedTemplate && (
                      <p className="text-[11px] text-ih-fg-4 mt-1">
                        Selected: {selectedTemplate.name}
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-2">
              <label className="block text-[12px] font-bold text-ih-fg-3 mb-1.5">Select Services</label>
              {hasServiceCatalog ? (
                <div className="grid grid-cols-2 gap-2">
                  {serviceCatalog.map((s) => (
                    <button key={s.id} onClick={() => toggleService(s.id)}
                      className={`text-left px-3 py-2 rounded-md text-[12px] font-medium border transition-colors ${services.has(s.id) ? "border-indigo-600 bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400" : "border-ih-border text-ih-fg-3"}`}
                    >
                      {services.has(s.id) ? "✓ " : ""}{s.name}
                      {typeof s.price === "number" && s.price > 0 ? (
                        <span className="ml-1 text-ih-fg-4">${s.price}</span>
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-[12px] text-ih-fg-4 px-1 py-2">
                  No services configured. You can add services under Settings, or continue and the
                  inspection will be created from the template only.
                </p>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div>
                <label className="block text-[12px] font-bold text-ih-fg-3 mb-1.5">Date</label>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] focus:shadow-ih-focus outline-none" />
              </div>
              <div>
                <label className="block text-[12px] font-bold text-ih-fg-3 mb-1.5">Time</label>
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] focus:shadow-ih-focus outline-none" />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div>
                <label className="block text-[12px] font-bold text-ih-fg-3 mb-1.5">Team Mode</label>
                <div className="flex gap-2">
                  <button onClick={() => setSoloMode(true)} className={`flex-1 py-2 rounded-md text-[12px] font-bold border transition-colors ${soloMode ? "border-indigo-600 bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400" : "border-ih-border text-ih-fg-3"}`}>Solo</button>
                  <button onClick={() => setSoloMode(false)} className={`flex-1 py-2 rounded-md text-[12px] font-bold border transition-colors ${!soloMode ? "border-indigo-600 bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400" : "border-ih-border text-ih-fg-3"}`}>Team</button>
                </div>
              </div>
              {!soloMode && (
                <div>
                  <label className="block text-[12px] font-bold text-ih-fg-3 mb-1.5">Inspector</label>
                  <input value={inspectorId} onChange={(e) => setInspectorId(e.target.value)} placeholder="Inspector ID or name" className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] focus:shadow-ih-focus outline-none" />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-ih-border">
          <button onClick={() => step > 0 ? setStep(step - 1) : onClose()} className="h-8 px-4 rounded-md border border-ih-border text-[13px] font-medium text-ih-fg-3 hover:bg-ih-bg-muted">
            {step > 0 ? "Back" : "Cancel"}
          </button>
          {step < STEPS.length - 1 ? (
            <button disabled={!canNext} onClick={() => setStep(step + 1)} className="h-8 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 disabled:opacity-40 disabled:cursor-not-allowed">
              Next
            </button>
          ) : (
            <button onClick={handleSubmit} className="h-8 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600">
              Create Inspection
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
