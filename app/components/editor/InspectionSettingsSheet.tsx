import { useState, useEffect, useCallback, useRef } from "react";
import { useFetcher } from "react-router";

interface SettingsForm {
  date: string;
  closingDate: string;
  inspectorId: string;
  orderId: string;
  referralSource: string;
  templateId: string;
  price: number;
  paymentRequired: boolean;
  agreementRequired: boolean;
}

interface Inspector {
  id: string;
  name: string;
  email: string;
}

interface Template {
  id: string;
  name: string;
}

interface InspectionSettingsSheetProps {
  open: boolean;
  onClose: () => void;
  inspectionId: string;
  referralSources?: string[];
  /** Called after a successful save where the template selection changed. */
  onTemplateApplied?: () => void;
}

type SaveState = "idle" | "saving" | "saved" | "error";

export function InspectionSettingsSheet({ open, onClose, inspectionId, referralSources = [], onTemplateApplied }: InspectionSettingsSheetProps) {
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [inspectors, setInspectors] = useState<Inspector[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [form, setForm] = useState<SettingsForm>({
    date: "",
    closingDate: "",
    inspectorId: "",
    orderId: "",
    referralSource: "",
    templateId: "",
    price: 0,
    paymentRequired: false,
    agreementRequired: false,
  });
  // Tracks the templateId that was loaded when the sheet opened, so we can
  // detect whether the user changed it before saving.
  const templateIdAtOpen = useRef<string>("");
  // B-22 follow-up (C-12): saves go through the inspection-edit route action
  // ("save-settings" intent) on a DEDICATED fetcher — the old raw client-side
  // fetch('/api/inspections/:id', PATCH) could never pass requireCsrfToken, so
  // every save silently 401/403'd. A dedicated fetcher (not shared) avoids the
  // B-17 shared-fetcher abort hazard. templateChanged is captured at submit so
  // the response effect knows whether to fire onTemplateApplied.
  const saveFetcher = useFetcher<{ ok: boolean; intent?: string }>();
  const templateChangedAtSubmit = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [inspRes, tplRes, insRes] = await Promise.all([
        fetch(`/api/inspections/${inspectionId}`, { credentials: "include" }),
        fetch("/api/inspections/templates", { credentials: "include" }),
        fetch("/api/team/members", { credentials: "include" }),
      ]);
      if (inspRes.ok) {
        const { data } = (await inspRes.json()) as { data: Record<string, unknown> };
        const loadedTemplateId = (data.templateId as string) || "";
        templateIdAtOpen.current = loadedTemplateId;
        setForm({
          date: (data.date as string) || "",
          closingDate: (data.closingDate as string) || "",
          inspectorId: (data.inspectorId as string) || "",
          orderId: (data.orderId as string) || "",
          referralSource: (data.referralSource as string) || "",
          templateId: loadedTemplateId,
          price: (data.price as number) || 0,
          paymentRequired: !!data.paymentRequired,
          agreementRequired: !!data.agreementRequired,
        });
      }
      if (tplRes.ok) {
        const { data } = (await tplRes.json()) as { data: Template[] };
        setTemplates(data || []);
      }
      if (insRes.ok) {
        const { data } = (await insRes.json()) as { data: Inspector[] };
        setInspectors(data || []);
      }
    } catch {
      // degrade gracefully
    } finally {
      setLoading(false);
    }
  }, [inspectionId]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  // Drive saveState from the dedicated fetcher's lifecycle. submitting → saving;
  // response ok → saved (+ onTemplateApplied if the template changed); not ok →
  // error. B-17 lesson: "idle" alone is not "saved" — gate on the action's ok.
  useEffect(() => {
    if (saveFetcher.state !== "idle") {
      setSaveState("saving");
      return;
    }
    const data = saveFetcher.data;
    if (!data || data.intent !== "save-settings") return;
    if (data.ok) {
      setSaveState("saved");
      if (templateChangedAtSubmit.current) onTemplateApplied?.();
      templateChangedAtSubmit.current = false;
      const timer = setTimeout(() => setSaveState("idle"), 2000);
      return () => clearTimeout(timer);
    }
    setSaveState("error");
  }, [saveFetcher.state, saveFetcher.data, onTemplateApplied]);

  if (!open) return null;

  function updateForm<K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaveState("saving");
    templateChangedAtSubmit.current = form.templateId !== templateIdAtOpen.current;
    saveFetcher.submit(
      { intent: "save-settings", payload: JSON.stringify(form) },
      { method: "post" },
    );
  }

  const inputClass = "mt-1 w-full h-10 px-3 rounded-md border border-ih-border bg-ih-bg-card text-ih-fg-1 text-[14px] font-medium focus:border-ih-primary focus:shadow-ih-focus outline-none";
  const labelClass = "text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3";

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[60] bg-[rgba(15,23,42,0.4)] backdrop-blur-sm" onClick={onClose} aria-hidden="true" />

      {/* Slide-over panel */}
      <aside className="fixed top-0 right-0 bottom-0 w-full max-w-xl z-[61] bg-ih-bg-card border-l border-ih-border shadow-ih-popover flex flex-col" role="dialog" aria-modal="true" aria-label="Inspection settings">
        <header className="flex items-center justify-between gap-3 px-5 py-3 border-b border-ih-border">
          <div className="min-w-0">
            <h2 className="text-[14px] font-bold text-ih-fg-1">Inspection settings</h2>
            <p className="text-[11px] text-ih-fg-3">Schedule, people, template, pricing & gates</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 rounded-md text-ih-fg-4 hover:text-ih-fg-2 hover:bg-ih-bg-muted">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="space-y-2 py-4" aria-busy="true">
              <div className="h-4 bg-ih-bg-muted rounded animate-pulse" style={{ width: "50%" }} />
              <div className="h-4 bg-ih-bg-muted rounded animate-pulse" style={{ width: "75%" }} />
            </div>
          ) : (
            <form onSubmit={handleSave} className="space-y-6 max-w-2xl">
              <fieldset className="space-y-4">
                <legend className="text-[15px] font-semibold tracking-tight text-ih-fg-1">Schedule</legend>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label className="block">
                    <span className={labelClass}>Date</span>
                    <input type="date" value={form.date} onChange={(e) => updateForm("date", e.target.value)} className={inputClass} />
                  </label>
                  <label className="block">
                    <span className={labelClass}>Inspector</span>
                    <select value={form.inspectorId} onChange={(e) => updateForm("inspectorId", e.target.value)} className={inputClass}>
                      <option value="">--- Unassigned ---</option>
                      {inspectors.map((u) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
                    </select>
                  </label>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label className="block">
                    <span className={labelClass}>Closing Date</span>
                    <input type="date" value={form.closingDate} onChange={(e) => updateForm("closingDate", e.target.value)} className={inputClass} data-testid="inspection-closing-date" />
                  </label>
                </div>
              </fieldset>

              <fieldset className="space-y-4">
                <legend className="text-[15px] font-semibold tracking-tight text-ih-fg-1">Order & referral</legend>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label className="block">
                    <span className={labelClass}>Order ID</span>
                    <input type="text" maxLength={64} placeholder="---" value={form.orderId} onChange={(e) => updateForm("orderId", e.target.value)} className={inputClass} data-testid="inspection-order-id" />
                  </label>
                  <label className="block">
                    <span className={labelClass}>Referral Source</span>
                    <select value={form.referralSource} onChange={(e) => updateForm("referralSource", e.target.value)} className={inputClass} data-testid="inspection-referral-source">
                      <option value="">--- Select source ---</option>
                      {referralSources.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>
                </div>
              </fieldset>

              <fieldset className="space-y-4">
                <legend className="text-[15px] font-semibold tracking-tight text-ih-fg-1">Template</legend>
                <label className="block">
                  <span className={labelClass}>Inspection template</span>
                  <select value={form.templateId} onChange={(e) => updateForm("templateId", e.target.value)} className={inputClass}>
                    <option value="">--- Select template ---</option>
                    {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </label>
              </fieldset>

              <fieldset className="space-y-4">
                <legend className="text-[15px] font-semibold tracking-tight text-ih-fg-1">Pricing & gates</legend>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label className="block">
                    <span className={labelClass}>Price (cents)</span>
                    <input type="number" min={0} step={100} value={form.price} onChange={(e) => updateForm("price", Number(e.target.value))} className={inputClass} />
                  </label>
                  <div className="flex flex-col gap-2 pt-5">
                    <label className="inline-flex items-center gap-2 text-[13px] text-ih-fg-3">
                      <input type="checkbox" checked={form.paymentRequired} onChange={(e) => updateForm("paymentRequired", e.target.checked)} className="h-4 w-4 rounded border-ih-border-strong text-ih-primary focus:ring-ih-primary/30" />
                      Payment required to view report
                    </label>
                    <label className="inline-flex items-center gap-2 text-[13px] text-ih-fg-3">
                      <input type="checkbox" checked={form.agreementRequired} onChange={(e) => updateForm("agreementRequired", e.target.checked)} className="h-4 w-4 rounded border-ih-border-strong text-ih-primary focus:ring-ih-primary/30" />
                      Agreement signature required
                    </label>
                  </div>
                </div>
              </fieldset>

              <div className="flex items-center justify-end gap-3 border-t border-ih-border pt-4">
                {saveState === "saving" && <span className="text-[12px] text-ih-watch-fg font-bold">Saving...</span>}
                {saveState === "saved" && <span className="text-[12px] text-ih-ok-fg font-bold">Saved</span>}
                {saveState === "error" && <span className="text-[12px] text-ih-bad-fg font-bold">Error -- try again</span>}
                <button type="submit" disabled={saveState === "saving"} className="h-10 px-4 rounded-md bg-ih-primary text-white text-[13px] font-bold hover:bg-ih-primary-600 disabled:bg-ih-border-strong">
                  Save changes
                </button>
              </div>
            </form>
          )}
        </div>
      </aside>
    </>
  );
}
