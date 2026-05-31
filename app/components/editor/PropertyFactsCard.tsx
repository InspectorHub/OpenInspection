import { useState, useCallback } from "react";

const FOUNDATION_OPTIONS = [
  { value: "", label: "---" },
  { value: "basement", label: "Basement" },
  { value: "slab", label: "Slab" },
  { value: "crawlspace", label: "Crawlspace" },
  { value: "other", label: "Other" },
] as const;

interface PropertyFacts {
  yearBuilt: number | null;
  sqft: number | null;
  foundationType: string;
  lotSize: string;
  bedrooms: number | null;
  bathrooms: number | null;
}

interface PropertyFactsCardProps {
  inspectionId: string;
  initialFacts?: Partial<PropertyFacts>;
  onSaved?: (facts: PropertyFacts) => void;
}

type SaveState = "idle" | "saving" | "saved" | "error";
type AutofillState = "idle" | "pending" | "success" | "no_key" | "not_found" | "error";

export function PropertyFactsCard({ inspectionId, initialFacts, onSaved }: PropertyFactsCardProps) {
  const [facts, setFacts] = useState<PropertyFacts>({
    yearBuilt: initialFacts?.yearBuilt ?? null,
    sqft: initialFacts?.sqft ?? null,
    foundationType: initialFacts?.foundationType ?? "",
    lotSize: initialFacts?.lotSize ?? "",
    bedrooms: initialFacts?.bedrooms ?? null,
    bathrooms: initialFacts?.bathrooms ?? null,
  });
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [autofillState, setAutofillState] = useState<AutofillState>("idle");
  const [autofillMessage, setAutofillMessage] = useState("");

  const saveFact = useCallback(async (key: keyof PropertyFacts, value: string) => {
    setSaveState("saving");
    try {
      const parsed = ["yearBuilt", "sqft", "bedrooms", "bathrooms"].includes(key)
        ? (value ? Number(value) : null)
        : value;
      const res = await fetch(`/api/inspections/${inspectionId}/property-facts`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: parsed }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const updated = { ...facts, [key]: parsed } as PropertyFacts;
      setFacts(updated);
      onSaved?.(updated);
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 2000);
    } catch {
      setSaveState("error");
    }
  }, [inspectionId, facts, onSaved]);

  async function autofillFromAddress() {
    setAutofillState("pending");
    setAutofillMessage("");
    try {
      const res = await fetch(`/api/inspections/${inspectionId}/property-facts/autofill`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json() as { data: Partial<PropertyFacts> | null; reason?: string };
      if (data.reason === "NO_API_KEY") {
        setAutofillState("no_key");
        setAutofillMessage("Auto-fill not configured. Enter facts manually.");
        return;
      }
      if (!data.data) {
        setAutofillState("not_found");
        setAutofillMessage("No public records found for this address.");
        return;
      }
      const merged = { ...facts };
      for (const [k, v] of Object.entries(data.data)) {
        if (v != null && (merged[k as keyof PropertyFacts] == null || merged[k as keyof PropertyFacts] === "")) {
          (merged as Record<string, unknown>)[k] = v;
        }
      }
      setFacts(merged);
      setAutofillState("success");
      setAutofillMessage("Facts auto-filled from public records. Review and save.");
    } catch {
      setAutofillState("error");
      setAutofillMessage("Auto-fill failed. Try again later.");
    }
  }

  const inputClass = "mt-1 w-full h-10 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[14px] font-medium tabular-nums focus:border-indigo-500 focus:shadow-ih-focus outline-none placeholder:text-slate-300 dark:placeholder:text-slate-600 text-ih-fg-1";
  const labelClass = "text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3";

  return (
    <fieldset className="space-y-4" data-testid="property-facts-card">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <legend className="text-[16px] font-semibold tracking-tight text-ih-fg-1">Property facts</legend>
          <p className="text-[12px] text-ih-fg-3">Surfaced as a banner on the published report. Leave blank for fields you didn't capture.</p>
        </div>
        <button type="button" onClick={autofillFromAddress} disabled={autofillState === "pending"} className="h-8 px-3 rounded-md bg-ih-primary-tint text-ih-primary text-[12px] font-bold ring-1 ring-inset ring-ih-primary-tint hover:bg-ih-primary-tint disabled:opacity-50 disabled:cursor-wait inline-flex items-center gap-1.5" data-testid="property-facts-autofill">
          {autofillState === "pending" ? "Fetching..." : "Auto-fill from address"}
        </button>
      </div>

      {autofillMessage && (
        <p className={`text-[12px] px-3 py-2 rounded-md ring-1 ring-inset ${
          autofillState === "success" ? "text-ih-ok-fg bg-ih-ok-bg ring-emerald-200" :
          autofillState === "no_key" ? "text-slate-700 bg-slate-50 ring-slate-200" :
          autofillState === "not_found" ? "text-ih-watch-fg bg-ih-watch-bg ring-amber-200" :
          "text-ih-bad-fg bg-ih-bad-bg ring-rose-200"
        }`} data-testid="property-facts-autofill-message">{autofillMessage}</p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <label className="block">
          <span className={labelClass}>Year Built</span>
          <input type="number" min={1800} max={2100} step={1} placeholder="---" value={facts.yearBuilt ?? ""} onChange={(e) => setFacts({ ...facts, yearBuilt: e.target.value ? Number(e.target.value) : null })} onBlur={(e) => saveFact("yearBuilt", e.target.value)} className={inputClass} data-testid="property-facts-year-built" />
        </label>
        <label className="block">
          <span className={labelClass}>SqFt</span>
          <input type="number" min={0} step={1} placeholder="---" value={facts.sqft ?? ""} onChange={(e) => setFacts({ ...facts, sqft: e.target.value ? Number(e.target.value) : null })} onBlur={(e) => saveFact("sqft", e.target.value)} className={inputClass} data-testid="property-facts-sqft" />
        </label>
        <label className="block">
          <span className={labelClass}>Foundation Type</span>
          <select value={facts.foundationType} onChange={(e) => { setFacts({ ...facts, foundationType: e.target.value }); saveFact("foundationType", e.target.value); }} className={inputClass} data-testid="property-facts-foundation">
            {FOUNDATION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className={labelClass}>Lot Size</span>
          <input type="text" maxLength={50} placeholder="---" value={facts.lotSize} onChange={(e) => setFacts({ ...facts, lotSize: e.target.value })} onBlur={(e) => saveFact("lotSize", e.target.value)} className={inputClass} data-testid="property-facts-lot-size" />
        </label>
        <label className="block">
          <span className={labelClass}>Bedrooms</span>
          <input type="number" min={0} step={1} placeholder="---" value={facts.bedrooms ?? ""} onChange={(e) => setFacts({ ...facts, bedrooms: e.target.value ? Number(e.target.value) : null })} onBlur={(e) => saveFact("bedrooms", e.target.value)} className={inputClass} data-testid="property-facts-bedrooms" />
        </label>
        <label className="block">
          <span className={labelClass}>Bathrooms</span>
          <input type="number" min={0} step={0.5} placeholder="---" value={facts.bathrooms ?? ""} onChange={(e) => setFacts({ ...facts, bathrooms: e.target.value ? Number(e.target.value) : null })} onBlur={(e) => saveFact("bathrooms", e.target.value)} className={inputClass} data-testid="property-facts-bathrooms" />
        </label>
      </div>

      <div className="text-[12px]" aria-live="polite">
        {saveState === "saving" && <span className="text-ih-watch-fg font-bold">Saving...</span>}
        {saveState === "saved" && <span className="text-ih-ok-fg font-bold">Saved</span>}
        {saveState === "error" && <span className="text-ih-bad-fg font-bold">Couldn't save -- try again</span>}
      </div>
    </fieldset>
  );
}
