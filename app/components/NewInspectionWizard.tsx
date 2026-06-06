import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { buildWizardSteps, todayLocalISO, formatPriceCents, type WizardStepId } from "~/lib/wizard-steps";
import { getEffectivePriceCents } from "~/lib/effective-price";

const STEP_LABELS: Record<WizardStepId, string> = {
  property: "Property",
  people: "People",
  services: "Services",
  schedule: "Schedule",
  team: "Team",
};

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

export interface WizardTeamMember {
  id: string;
  name: string;
}

/** Agent row returned by the search-agents action intent. */
interface AgentResult {
  id: string;
  name: string;
  email: string | null;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function NewInspectionWizard({
  open,
  onClose,
  templates = [],
  services: serviceCatalog = [],
  teamMembers = [],
}: {
  open: boolean;
  onClose: () => void;
  templates?: WizardTemplate[];
  services?: WizardService[];
  /** B-21 — when empty (solo workspace) the Team step is skipped entirely. */
  teamMembers?: WizardTeamMember[];
}) {
  const fetcher = useFetcher();
  // IA-1 — dedicated fetcher for agent typeahead (B-17: per-intent convention,
  // separate fetcher prevents competing mutations from cancelling each other).
  const agentFetcher = useFetcher<{ intent: "search-agents"; agents: AgentResult[] }>();
  const agentDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // IA-6 — advisory schedule conflict detection (separate fetcher to avoid
  // cancelling the submit fetcher; B-17 convention).
  const conflictFetcher = useFetcher<{
    conflicts: Array<{ inspectionId: string; propertyAddress: string; date: string }>;
  }>();

  const [stepIdx, setStepIdx] = useState(0);
  const [propertyType, setPropertyType] = useState("single_family");
  const [address, setAddress] = useState("");
  const [templateId, setTemplateId] = useState("");
  // Stores selected service IDs (matched against the tenant's services table).
  const [services, setServices] = useState<Set<string>>(new Set());
  // P-4: per-service price overrides (serviceId → cents). Only populated when
  // the inspector edits the price input for a selected service.
  const [priceOverrides, setPriceOverrides] = useState<Map<string, number>>(new Map());
  // B-21: on-site creation is overwhelmingly same-day — default to today.
  const [date, setDate] = useState(() => todayLocalISO());
  const [time, setTime] = useState("09:00");
  const [soloMode, setSoloMode] = useState(true);
  const [inspectorId, setInspectorId] = useState("");

  // IA-1 People step state
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  // Agent: either a selected existing contact or inline-new mode.
  const [agentSearch, setAgentSearch] = useState("");
  const [agentDropdownOpen, setAgentDropdownOpen] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<AgentResult | null>(null);
  const [newAgentMode, setNewAgentMode] = useState(false);
  const [newAgentName, setNewAgentName] = useState("");
  const [newAgentEmail, setNewAgentEmail] = useState("");

  const hasServiceCatalog = serviceCatalog.length > 0;

  // B-21 — steps with nothing to decide are skipped instead of rendered as
  // empty placeholders ("No services configured" + a mandatory Next click).
  const steps = useMemo(
    () =>
      buildWizardSteps({
        hasServiceCatalog,
        hasTeamChoices: teamMembers.length > 0,
      }),
    [hasServiceCatalog, teamMembers.length],
  );
  const step: WizardStepId = steps[Math.min(stepIdx, steps.length - 1)];

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

  // B-21 — when the search narrows to exactly one template, select it; the
  // search box and dropdown previously acted as two disconnected controls.
  useEffect(() => {
    if (templateQuery.trim() && filteredTemplates.length === 1) {
      setTemplateId(filteredTemplates[0].id);
    }
  }, [templateQuery, filteredTemplates]);

  useEffect(() => {
    if (open) return;
    setStepIdx(0);
    setPropertyType("single_family");
    setAddress("");
    setTemplateId("");
    setTemplateQuery("");
    setServices(new Set());
    setPriceOverrides(new Map());
    setDate(todayLocalISO());
    setTime("09:00");
    setSoloMode(true);
    setInspectorId("");
    // IA-1 People step reset
    setClientName("");
    setClientEmail("");
    setClientPhone("");
    setAgentSearch("");
    setAgentDropdownOpen(false);
    setSelectedAgent(null);
    setNewAgentMode(false);
    setNewAgentName("");
    setNewAgentEmail("");
  }, [open]);

  // IA-6 — debounced schedule conflict check: fires 400 ms after either
  // inspectorId or date/time changes. With no explicit inspector chosen
  // (solo flow) the server checks the CALLER — that is who the inspection
  // will be assigned to. Advisory only — never blocks.
  useEffect(() => {
    if (!date) return;
    const combinedDate = `${date}T${time}:00Z`;
    const params = new URLSearchParams({ date: combinedDate });
    if (inspectorId) params.set("inspectorId", inspectorId);
    const t = setTimeout(() => {
      conflictFetcher.load(`/resources/schedule-conflicts?${params.toString()}`);
    }, 400);
    return () => clearTimeout(t);
  // conflictFetcher is stable across renders — intentionally omitted per RR convention.
  }, [inspectorId, date, time]);

  // IA-1 — agent typeahead: debounce ~300 ms, then POST search-agents intent
  // via the dedicated agentFetcher (BFF pattern, no direct client fetch).
  function handleAgentSearchChange(value: string) {
    setAgentSearch(value);
    setAgentDropdownOpen(value.trim().length >= 2);
    if (agentDebounceRef.current) clearTimeout(agentDebounceRef.current);
    if (value.trim().length >= 2) {
      agentDebounceRef.current = setTimeout(() => {
        agentFetcher.submit(
          { intent: "search-agents", search: value.trim() },
          { method: "post", action: "/dashboard" },
        );
      }, 300);
    }
  }

  function selectAgent(agent: AgentResult) {
    setSelectedAgent(agent);
    setAgentSearch("");
    setAgentDropdownOpen(false);
    setNewAgentMode(false);
    setNewAgentName("");
    setNewAgentEmail("");
  }

  function clearAgent() {
    setSelectedAgent(null);
    setAgentSearch("");
    setAgentDropdownOpen(false);
  }

  function enableNewAgentMode() {
    setNewAgentMode(true);
    setSelectedAgent(null);
    setAgentSearch("");
    setAgentDropdownOpen(false);
  }

  if (!open) return null;

  const toggleService = (id: string) => {
    setServices((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        // Clear any price override when unselecting a service.
        setPriceOverrides((po) => {
          const m = new Map(po);
          m.delete(id);
          return m;
        });
      } else {
        next.add(id);
      }
      return next;
    });
  };

  /** P-4: Update the price override for a selected service.
   *  `dollarValue` is the raw string from the number input (e.g. "449.99").
   *  Uses Math.round(v * 100) to avoid float precision errors (44999, not 44998.999).
   *  Clearing the input (empty string) or matching the catalog price removes the override.
   */
  function handlePriceOverrideChange(serviceId: string, dollarValue: string, catalogCents: number | null | undefined) {
    if (dollarValue === '') {
      setPriceOverrides((prev) => {
        const m = new Map(prev);
        m.delete(serviceId);
        return m;
      });
      return;
    }
    const parsed = parseFloat(dollarValue);
    if (!isFinite(parsed) || parsed < 0) return;
    const cents = Math.round(parsed * 100);
    // If the value equals the catalog price, treat it as "no override".
    if (catalogCents != null && cents === catalogCents) {
      setPriceOverrides((prev) => {
        const m = new Map(prev);
        m.delete(serviceId);
        return m;
      });
    } else {
      setPriceOverrides((prev) => new Map(prev).set(serviceId, cents));
    }
  }

  // IA-1 — People step: block Next when email or phone is filled without a name.
  const clientHasContact = clientEmail.trim().length > 0 || clientPhone.trim().length > 0;
  const clientNameMissing = clientHasContact && clientName.trim().length === 0;

  const canNext =
    // propertyAddress has a min(5) server constraint — enforce it here so the
    // wizard cannot advance into an inevitable 400.
    step === "property" ? address.trim().length >= 5 && templateId.length > 0 :
    // People: optional, but name is required when email or phone are filled.
    step === "people" ? !clientNameMissing :
    step === "services" ? services.size > 0 :
    step === "schedule" ? date.length > 0 :
    true;

  // B-21 — the backdrop used to discard a half-filled wizard on a stray
  // click. Once the form is dirty, only Cancel / × close it (no native
  // confirm dialogs per project convention).
  const dirty = address.trim().length > 0 || templateId.length > 0 || services.size > 0;
  const handleBackdrop = () => {
    if (!dirty) onClose();
  };

  function handleSubmit() {
    // P-4: Build serviceSelections with optional per-row price overrides.
    // Also keep legacy serviceIds for backward compat (the server uses
    // serviceSelections as the authoritative source when both are present).
    const serviceSelectionsJson = JSON.stringify(
      [...services].map((id) => {
        const override = priceOverrides.get(id);
        return override !== undefined
          ? { serviceId: id, priceOverrideCents: override }
          : { serviceId: id };
      }),
    );

    fetcher.submit(
      {
        intent: "create",
        propertyType,
        address,
        templateId,
        serviceIds: [...services].join(","),
        serviceSelectionsJson,
        date,
        time,
        soloMode: String(soloMode),
        inspectorId,
        // IA-1 People step fields
        clientName,
        clientEmail,
        clientPhone,
        agentContactId: selectedAgent?.id ?? "",
        newAgentName: !selectedAgent ? newAgentName : "",
        newAgentEmail: !selectedAgent ? newAgentEmail : "",
      },
      { method: "post", action: "/dashboard" },
    );
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,23,42,0.4)] backdrop-blur-sm" onClick={handleBackdrop}>
      <div className="w-full max-w-lg bg-ih-bg-card rounded-xl shadow-ih-popover" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-ih-border">
          <h2 className="text-[16px] font-bold">New Inspection</h2>
          <button onClick={onClose} className="text-ih-fg-4 hover:text-ih-fg-2 text-lg leading-none">&times;</button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-1 px-6 pt-4">
          {steps.map((s, i) => (
            <div key={s} className="flex items-center gap-1 flex-1">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold ${i <= stepIdx ? "bg-ih-primary text-white" : "bg-ih-bg-muted text-ih-fg-4"}`}>{i + 1}</div>
              <span className={`text-[11px] font-medium hidden sm:inline ${i <= stepIdx ? "text-ih-primary" : "text-ih-fg-4"}`}>{STEP_LABELS[s]}</span>
              {i < steps.length - 1 && <div className={`flex-1 h-px mx-1 ${i < stepIdx ? "bg-ih-primary" : "bg-ih-bg-muted"}`} />}
            </div>
          ))}
        </div>

        {/* Body */}
        <div className="px-6 py-5 min-h-[220px]">
          {step === "property" && (
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
          )}

          {step === "people" && (
            <div className="space-y-5">
              {/* CLIENT section */}
              <div className="space-y-3">
                <p className="text-[12px] font-bold text-ih-fg-3 uppercase tracking-wide">Client</p>
                <div>
                  <label className="block text-[12px] font-bold text-ih-fg-3 mb-1.5">Name</label>
                  <input
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    placeholder="Client full name"
                    className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] focus:shadow-ih-focus outline-none placeholder:text-ih-fg-4"
                  />
                  {clientNameMissing && (
                    <p className="text-[12px] text-ih-danger mt-1">Name is required when adding a client.</p>
                  )}
                  {!clientNameMissing && clientName.trim().length > 0 && clientEmail.trim().length === 0 && (
                    <p className="text-[12px] text-ih-fg-4 mt-1">Without an email you can&apos;t send the agreement or report later.</p>
                  )}
                </div>
                <div>
                  <label className="block text-[12px] font-bold text-ih-fg-3 mb-1.5">Email</label>
                  <input
                    type="email"
                    value={clientEmail}
                    onChange={(e) => setClientEmail(e.target.value)}
                    placeholder="client@example.com"
                    className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] focus:shadow-ih-focus outline-none placeholder:text-ih-fg-4"
                  />
                </div>
                <div>
                  <label className="block text-[12px] font-bold text-ih-fg-3 mb-1.5">Phone</label>
                  <input
                    type="tel"
                    value={clientPhone}
                    onChange={(e) => setClientPhone(e.target.value)}
                    placeholder="(555) 123-4567"
                    className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] focus:shadow-ih-focus outline-none placeholder:text-ih-fg-4"
                  />
                </div>
              </div>

              {/* AGENT section */}
              <div className="space-y-3">
                <p className="text-[12px] font-bold text-ih-fg-3 uppercase tracking-wide">Agent</p>

                {selectedAgent ? (
                  /* Chip for the selected agent */
                  <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-ih-primary bg-ih-primary-tint">
                    <span className="flex-1 text-[13px] font-medium text-ih-primary">
                      {selectedAgent.name}
                      {selectedAgent.email ? <span className="ml-1 text-ih-fg-4 font-normal text-[12px]">({selectedAgent.email})</span> : null}
                    </span>
                    <button
                      type="button"
                      onClick={clearAgent}
                      className="text-ih-fg-4 hover:text-ih-fg-2 text-base leading-none"
                      aria-label="Remove selected agent"
                    >&times;</button>
                  </div>
                ) : newAgentMode ? (
                  /* Inline new-agent form */
                  <div className="space-y-3 p-3 rounded-md border border-ih-border bg-ih-bg-muted">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-[12px] font-bold text-ih-fg-3">New Agent</p>
                      <button
                        type="button"
                        onClick={() => setNewAgentMode(false)}
                        className="text-[12px] text-ih-fg-4 hover:text-ih-fg-2"
                      >Cancel</button>
                    </div>
                    <div>
                      <label className="block text-[12px] font-bold text-ih-fg-3 mb-1.5">Name</label>
                      <input
                        value={newAgentName}
                        onChange={(e) => setNewAgentName(e.target.value)}
                        placeholder="Agent full name"
                        className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] focus:shadow-ih-focus outline-none placeholder:text-ih-fg-4"
                      />
                    </div>
                    <div>
                      <label className="block text-[12px] font-bold text-ih-fg-3 mb-1.5">Email</label>
                      <input
                        type="email"
                        value={newAgentEmail}
                        onChange={(e) => setNewAgentEmail(e.target.value)}
                        placeholder="agent@realty.com"
                        className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] focus:shadow-ih-focus outline-none placeholder:text-ih-fg-4"
                      />
                    </div>
                  </div>
                ) : (
                  /* Typeahead search */
                  <div className="relative">
                    <input
                      value={agentSearch}
                      onChange={(e) => handleAgentSearchChange(e.target.value)}
                      onBlur={() => {
                        // Small delay so click on dropdown item fires first.
                        setTimeout(() => setAgentDropdownOpen(false), 150);
                      }}
                      placeholder="Search agents…"
                      className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] focus:shadow-ih-focus outline-none placeholder:text-ih-fg-4"
                    />
                    {agentDropdownOpen && (
                      <div className="absolute z-10 w-full mt-1 rounded-md border border-ih-border bg-ih-bg-card shadow-ih-popover overflow-hidden">
                        {agentFetcher.state === "submitting" || agentFetcher.state === "loading" ? (
                          <p className="px-3 py-2 text-[12px] text-ih-fg-4">Searching…</p>
                        ) : agentFetcher.data?.agents && agentFetcher.data.agents.length > 0 ? (
                          agentFetcher.data.agents.map((a) => (
                            <button
                              key={a.id}
                              type="button"
                              onMouseDown={() => selectAgent(a)}
                              className="w-full text-left px-3 py-2 text-[13px] hover:bg-ih-bg-muted border-b border-ih-border last:border-b-0"
                            >
                              <span className="font-medium">{a.name}</span>
                              {a.email ? <span className="ml-2 text-ih-fg-4 text-[12px]">{a.email}</span> : null}
                            </button>
                          ))
                        ) : agentFetcher.data ? (
                          <p className="px-3 py-2 text-[12px] text-ih-fg-4">No agents found.</p>
                        ) : null}
                      </div>
                    )}
                  </div>
                )}

                {!selectedAgent && !newAgentMode && (
                  <button
                    type="button"
                    onClick={enableNewAgentMode}
                    className="text-[12px] font-medium text-ih-primary hover:underline"
                  >+ New agent</button>
                )}
              </div>
            </div>
          )}

          {step === "services" && (
            <div className="space-y-2">
              <label className="block text-[12px] font-bold text-ih-fg-3 mb-1.5">Select Services</label>
              <div className="space-y-1.5">
                {serviceCatalog.map((s) => {
                  const selected = services.has(s.id);
                  const catalogCents = typeof s.price === "number" && s.price > 0 ? s.price : null;
                  const overrideCents = priceOverrides.get(s.id);
                  // Display value for the price input: override dollars, or catalog dollars, or empty.
                  const priceInputDefault =
                    overrideCents !== undefined
                      ? (overrideCents / 100).toFixed(2)
                      : catalogCents !== null
                        ? (catalogCents / 100).toFixed(2)
                        : "";
                  return (
                    <div
                      key={s.id}
                      className={`flex items-center gap-2 px-3 py-2 rounded-md border transition-colors ${selected ? "border-ih-primary bg-ih-primary-tint" : "border-ih-border"}`}
                    >
                      {/* Checkbox + service name — clicking the left area toggles selection */}
                      <button
                        type="button"
                        onClick={() => toggleService(s.id)}
                        className={`flex-1 text-left text-[12px] font-medium flex items-center gap-1.5 ${selected ? "text-ih-primary" : "text-ih-fg-3"}`}
                      >
                        <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 text-[10px] font-bold ${selected ? "border-ih-primary bg-ih-primary text-white" : "border-ih-border"}`}>
                          {selected ? "✓" : ""}
                        </span>
                        {s.name}
                      </button>
                      {/* Price: editable input when selected, static text otherwise */}
                      {selected ? (
                        <div className="flex items-center gap-1">
                          <span className="text-[12px] text-ih-fg-4">$</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            defaultValue={priceInputDefault}
                            onBlur={(e) => handlePriceOverrideChange(s.id, e.target.value, catalogCents)}
                            onChange={(e) => handlePriceOverrideChange(s.id, e.target.value, catalogCents)}
                            className="w-20 h-7 px-1.5 rounded border border-ih-border bg-ih-bg-card text-[12px] text-right focus:shadow-ih-focus outline-none"
                            aria-label={`Price for ${s.name}`}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </div>
                      ) : catalogCents !== null ? (
                        // FE-7: price is stored in cents — "$400.00", not "$40000"
                        <span className="text-[12px] text-ih-fg-4 flex-shrink-0">{formatPriceCents(catalogCents)}</span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              {/* P-4: Live total across selected services — delegates to the authority-chain
                  helper. At wizard time there is no invoice yet, so only tier 2 applies.
                  Catalog svc.price maps to priceSnapshot; per-row priceOverrides maps to
                  priceOverride. Empty set falls through to zero (no cache row here). */}
              {services.size > 0 && (
                <div className="flex justify-end pt-1 border-t border-ih-border mt-2">
                  <span className="text-[12px] font-bold text-ih-fg-2">
                    Total:{" "}
                    {formatPriceCents(
                      getEffectivePriceCents({
                        serviceLines: [...services].map((id) => {
                          const svc = serviceCatalog.find((s) => s.id === id);
                          return {
                            priceSnapshot: typeof svc?.price === "number" ? svc.price : 0,
                            priceOverride: priceOverrides.get(id) ?? null,
                          };
                        }),
                      }),
                    )}
                  </span>
                </div>
              )}
            </div>
          )}

          {step === "schedule" && (
            <div className="space-y-4">
              <div>
                <label className="block text-[12px] font-bold text-ih-fg-3 mb-1.5">Date</label>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] focus:shadow-ih-focus outline-none" />
              </div>
              <div>
                <label className="block text-[12px] font-bold text-ih-fg-3 mb-1.5">Time</label>
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] focus:shadow-ih-focus outline-none" />
              </div>
              {/* IA-6 — advisory conflict warning; non-blocking. With no team
                  step (solo tenants) the inspection goes to the creator, and
                  the conflict check covers them by default. */}
              {(conflictFetcher.data?.conflicts?.length ?? 0) > 0 && (
                <div className="rounded-md border border-ih-watch/40 bg-ih-watch-bg px-3 py-2">
                  <p className="text-[12px] font-bold text-ih-watch-fg">
                    <strong>Schedule conflict:</strong>{" "}
                    {conflictFetcher.data!.conflicts.length === 1
                      ? `this inspector already has an inspection at ${conflictFetcher.data!.conflicts[0].propertyAddress}`
                      : `this inspector already has ${conflictFetcher.data!.conflicts.length} inspections`}{" "}
                    in this time slot. You can still schedule it.
                  </p>
                </div>
              )}
            </div>
          )}

          {step === "team" && (
            <div className="space-y-4">
              <div>
                <label className="block text-[12px] font-bold text-ih-fg-3 mb-1.5">Team Mode</label>
                <div className="flex gap-2">
                  <button onClick={() => setSoloMode(true)} className={`flex-1 py-2 rounded-md text-[12px] font-bold border transition-colors ${soloMode ? "border-ih-primary bg-ih-primary-tint text-ih-primary" : "border-ih-border text-ih-fg-3"}`}>Solo</button>
                  <button onClick={() => setSoloMode(false)} className={`flex-1 py-2 rounded-md text-[12px] font-bold border transition-colors ${!soloMode ? "border-ih-primary bg-ih-primary-tint text-ih-primary" : "border-ih-border text-ih-fg-3"}`}>Team</button>
                </div>
              </div>
              {!soloMode && (
                <div>
                  <label className="block text-[12px] font-bold text-ih-fg-3 mb-1.5">Inspector</label>
                  {teamMembers.length > 0 ? (
                    <select
                      value={inspectorId}
                      onChange={(e) => setInspectorId(e.target.value)}
                      className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] focus:shadow-ih-focus outline-none"
                    >
                      <option value="">Select an inspector…</option>
                      {teamMembers.map((m) => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                  ) : (
                    <input value={inspectorId} onChange={(e) => setInspectorId(e.target.value)} placeholder="Inspector ID or name" className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] focus:shadow-ih-focus outline-none" />
                  )}
                  {/* IA-6 — advisory conflict warning; non-blocking */}
                  {(conflictFetcher.data?.conflicts?.length ?? 0) > 0 && (
                    <div className="mt-2 rounded-md border border-ih-watch/40 bg-ih-watch-bg px-3 py-2">
                      <p className="text-[12px] font-bold text-ih-watch-fg">
                        <strong>Schedule conflict:</strong>{" "}
                        {conflictFetcher.data!.conflicts.length === 1
                          ? `this inspector already has an inspection at ${conflictFetcher.data!.conflicts[0].propertyAddress}`
                          : `this inspector already has ${conflictFetcher.data!.conflicts.length} inspections`}{" "}
                        in this time slot. You can still schedule it.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-ih-border">
          <button onClick={() => stepIdx > 0 ? setStepIdx(stepIdx - 1) : onClose()} className="h-8 px-4 rounded-md border border-ih-border text-[13px] font-medium text-ih-fg-3 hover:bg-ih-bg-muted">
            {stepIdx > 0 ? "Back" : "Cancel"}
          </button>
          {stepIdx < steps.length - 1 ? (
            <button disabled={!canNext} onClick={() => setStepIdx(stepIdx + 1)} className="h-8 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 disabled:opacity-40 disabled:cursor-not-allowed">
              Next
            </button>
          ) : (
            <button disabled={!canNext} onClick={handleSubmit} className="h-8 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 disabled:opacity-40 disabled:cursor-not-allowed">
              Create Inspection
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
