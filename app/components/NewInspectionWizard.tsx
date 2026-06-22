import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { buildWizardSteps, todayLocalISO, type WizardStepId } from "~/lib/wizard-steps";
import { PropertyStep } from "./new-inspection/PropertyStep";
import { PeopleStep } from "./new-inspection/PeopleStep";
import { ServicesStep } from "./new-inspection/ServicesStep";
import { ScheduleStep } from "./new-inspection/ScheduleStep";
import { TeamStep } from "./new-inspection/TeamStep";

const STEP_LABELS: Record<WizardStepId, string> = {
  property: "Property",
  people: "People",
  services: "Services",
  schedule: "Schedule",
  team: "Team",
};

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
export interface AgentResult {
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

  // Drop a service's price override (used when unselecting, clearing the input,
  // or when the entered price matches the catalog price = "no override").
  const removePriceOverride = (serviceId: string) =>
    setPriceOverrides((prev) => {
      const m = new Map(prev);
      m.delete(serviceId);
      return m;
    });

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
        removePriceOverride(id);
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
      removePriceOverride(serviceId);
      return;
    }
    const parsed = parseFloat(dollarValue);
    if (!isFinite(parsed) || parsed < 0) return;
    const cents = Math.round(parsed * 100);
    // If the value equals the catalog price, treat it as "no override".
    if (catalogCents != null && cents === catalogCents) {
      removePriceOverride(serviceId);
    } else {
      setPriceOverrides((prev) => new Map(prev).set(serviceId, cents));
    }
  }

  // IA-1 — People step: block Next when email or phone is filled without a name.
  const clientHasContact = clientEmail.trim().length > 0 || clientPhone.trim().length > 0;
  const clientNameMissing = clientHasContact && clientName.trim().length === 0;

  function canAdvanceFromStep(): boolean {
    switch (step) {
      case "property":
        // propertyAddress has a min(5) server constraint — enforce it here so the
        // wizard cannot advance into an inevitable 400.
        return address.trim().length >= 5 && templateId.length > 0;
      case "people":
        // People: optional, but name is required when email or phone are filled.
        return !clientNameMissing;
      case "services":
        return services.size > 0;
      case "schedule":
        return date.length > 0;
      default:
        return true;
    }
  }
  const canNext = canAdvanceFromStep();

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
      <div className="w-full max-w-lg max-h-[90vh] flex flex-col bg-ih-bg-card rounded-xl shadow-ih-popover" onClick={(e) => e.stopPropagation()}>
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

        {/* Body — flex-1 + scroll so a tall step never pushes the footer off-screen (card capped at max-h-[90vh]) */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
          {step === "property" && (
            <PropertyStep
              propertyType={propertyType}
              setPropertyType={setPropertyType}
              address={address}
              setAddress={setAddress}
              templates={templates}
              templateId={templateId}
              setTemplateId={setTemplateId}
              templateQuery={templateQuery}
              setTemplateQuery={setTemplateQuery}
              filteredTemplates={filteredTemplates}
              selectedTemplate={selectedTemplate}
            />
          )}

          {step === "people" && (
            <PeopleStep
              clientName={clientName}
              setClientName={setClientName}
              clientEmail={clientEmail}
              setClientEmail={setClientEmail}
              clientPhone={clientPhone}
              setClientPhone={setClientPhone}
              clientNameMissing={clientNameMissing}
              selectedAgent={selectedAgent}
              newAgentMode={newAgentMode}
              setNewAgentMode={setNewAgentMode}
              newAgentName={newAgentName}
              setNewAgentName={setNewAgentName}
              newAgentEmail={newAgentEmail}
              setNewAgentEmail={setNewAgentEmail}
              agentSearch={agentSearch}
              agentDropdownOpen={agentDropdownOpen}
              setAgentDropdownOpen={setAgentDropdownOpen}
              agentFetcher={agentFetcher}
              handleAgentSearchChange={handleAgentSearchChange}
              selectAgent={selectAgent}
              clearAgent={clearAgent}
              enableNewAgentMode={enableNewAgentMode}
            />
          )}

          {step === "services" && (
            <ServicesStep
              serviceCatalog={serviceCatalog}
              services={services}
              priceOverrides={priceOverrides}
              toggleService={toggleService}
              handlePriceOverrideChange={handlePriceOverrideChange}
            />
          )}

          {step === "schedule" && (
            <ScheduleStep
              date={date}
              setDate={setDate}
              time={time}
              setTime={setTime}
              conflictFetcher={conflictFetcher}
            />
          )}

          {step === "team" && (
            <TeamStep
              soloMode={soloMode}
              setSoloMode={setSoloMode}
              inspectorId={inspectorId}
              setInspectorId={setInspectorId}
              teamMembers={teamMembers}
              conflictFetcher={conflictFetcher}
            />
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
