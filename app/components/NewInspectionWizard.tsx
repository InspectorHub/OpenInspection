import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { buildWizardSteps, todayLocalISO, type WizardStepId } from "~/lib/wizard-steps";
import { PropertyStep } from "./new-inspection/PropertyStep";
import { PeopleStep } from "./new-inspection/PeopleStep";
import { ServicesStep } from "./new-inspection/ServicesStep";
import { ScheduleStep } from "./new-inspection/ScheduleStep";
import { TeamStep } from "./new-inspection/TeamStep";
import { QuotaExceededPanel } from "./new-inspection/QuotaExceededPanel";
import type { AddressSelection } from "~/routes/resources/places";
import { m } from "~/paraglide/messages";

function stepLabel(id: WizardStepId): string {
  switch (id) {
    case "property": return m.new_inspection_step_property();
    case "people": return m.new_inspection_step_people();
    case "services": return m.new_inspection_step_services();
    case "schedule": return m.new_inspection_step_schedule();
    case "team": return m.new_inspection_step_team();
  }
}

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
  quotaExceededAtOpen,
}: {
  open: boolean;
  onClose: () => void;
  templates?: WizardTemplate[];
  services?: WizardService[];
  /** B-21 — when empty (solo workspace) the Team step is skipped entirely. */
  teamMembers?: WizardTeamMember[];
  /**
   * Optional at-open free-tier quota gate. Callers that already load usage
   * data (the `/inspections` route, which mounts the QuotaBanner from the
   * same loader payload) pass this so a tenant already at the inspection cap
   * sees the upgrade panel the instant the wizard opens, instead of walking
   * all four steps and hitting the 402 QUOTA_EXHAUSTED on Create. Mirrors the
   * tri-state shape of the internal 402-driven `quotaExceeded` state below:
   * `undefined` = no gate (under cap, standalone/paid-saas caps==null, or a
   * mount with no quota context, e.g. a future command-palette-only entry
   * point) → normal wizard, server 402 remains the authoritative backstop;
   * `null` = at cap with no configured billing portal (CTA hidden); a string
   * is the billingPortalUrl for the "Subscribe" CTA.
   */
  quotaExceededAtOpen?: string | null;
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
  const holidayFetcher = useFetcher<{
    effect: "none" | "block" | "advisory";
    name: string | null;
  }>();

  const [stepIdx, setStepIdx] = useState(0);
  const [propertyType, setPropertyType] = useState("single_family");
  const [address, setAddress] = useState("");
  // #198 — structured, geocoded address captured when the inspector picks a
  // Places suggestion. Cleared when they edit the text back to free-form, so we
  // never persist stale coordinates against a hand-typed address.
  const [addressSel, setAddressSel] = useState<AddressSelection | null>(null);
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

  // Free-tier usage quotas — when the create POST comes back 402
  // QUOTA_EXHAUSTED, the wizard stays open and shows an upgrade panel instead
  // of silently closing. `undefined` = not exceeded; `null` = exceeded with no
  // configured billing portal (CTA hidden); a string is the billingPortalUrl.
  const [quotaExceeded, setQuotaExceeded] = useState<string | null | undefined>(undefined);

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
    if (!open) {
      setStepIdx(0);
      setPropertyType("single_family");
      setAddress("");
      setAddressSel(null);
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
      setQuotaExceeded(undefined);
      return;
    }
    // At-open quota gate — seed quotaExceeded from the caller-supplied prop
    // every time the modal opens, so a tenant already at cap sees the
    // upgrade panel immediately instead of the property step. Deliberately
    // NOT keyed on quotaExceededAtOpen (only on `open`): re-evaluating on
    // every parent re-render while the modal is already open would let a
    // background loader revalidation stomp on a 402 that just set
    // quotaExceeded to a different value via the submit-fetcher effect below.
    setQuotaExceeded(quotaExceededAtOpen);
  }, [open]);

  // Watch the create-submit fetcher for a QUOTA_EXHAUSTED (402) rejection.
  // A successful create returns a redirect from the action, which React
  // Router follows directly — fetcher.data never populates on that path, so
  // this effect only ever fires for a completed (non-redirect) response:
  // either the free-tier cap panel below, or the pre-existing close-on-any-
  // other-outcome behavior (unchanged from before this quota feature).
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    const data = fetcher.data as {
      intent?: string;
      ok?: boolean;
      error?: { code?: string; details?: { billingPortalUrl?: string | null } };
    };
    if (data.intent !== "create") return;
    if (data.ok === false && data.error?.code === "QUOTA_EXHAUSTED") {
      setQuotaExceeded(data.error.details?.billingPortalUrl ?? null);
      return;
    }
    onClose();
  // onClose is re-created every render (inline arrow at the call site) but is
  // always functionally equivalent (`() => setWizardOpen(false)`, and setState
  // setters are referentially stable) — intentionally omitted to avoid
  // re-running this effect on every parent render, mirroring the
  // conflictFetcher effect above.
  }, [fetcher.state, fetcher.data]);

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

  // Company holiday advisory / block for the selected civil date.
  useEffect(() => {
    if (!date) return;
    const t = setTimeout(() => {
      holidayFetcher.load(`/resources/holiday-check?date=${encodeURIComponent(date)}`);
    }, 300);
    return () => clearTimeout(t);
  }, [date]);

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
          { method: "post", action: "/inspections" },
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

  // #198 — editing the address text by hand invalidates any previously picked
  // Places suggestion (its coordinates no longer describe what's typed).
  function handleAddressChange(v: string) {
    setAddress(v);
    if (addressSel) setAddressSel(null);
  }
  function handleAddressSelect(sel: AddressSelection) {
    setAddressSel(sel);
    setAddress(sel.formatted);
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
   *  `cents` is the parsed integer-cents value from the MoneyInput (or null when
   *  the field is cleared). Clearing the input or matching the catalog price
   *  removes the override.
   */
  function handlePriceOverrideChange(serviceId: string, cents: number | null, catalogCents: number | null | undefined) {
    if (cents == null) {
      removePriceOverride(serviceId);
      return;
    }
    if (cents < 0) return;
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
        return date.length > 0 && holidayFetcher.data?.effect !== "block";
      default:
        return true;
    }
  }
  const canNext = canAdvanceFromStep();

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
        // #198 — structured geocoded address (empty strings when the inspector
        // typed a free-form address the API couldn't match; the server stamps
        // addressGeocodedAt itself).
        addressPlaceId: addressSel?.placeId ?? "",
        addressStreet: addressSel?.street ?? "",
        addressCity: addressSel?.city ?? "",
        addressState: addressSel?.state ?? "",
        addressZip: addressSel?.zip ?? "",
        addressCounty: addressSel?.county ?? "",
        addressLat: addressSel?.lat != null ? String(addressSel.lat) : "",
        addressLng: addressSel?.lng != null ? String(addressSel.lng) : "",
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
      { method: "post", action: "/inspections" },
    );
    // Closing happens once the fetcher settles (see the effect above) — a
    // QUOTA_EXHAUSTED rejection keeps the wizard open to show the upgrade
    // panel instead of closing immediately on submit.
  }

  return (
    <div className="w-full max-w-[720px] mx-auto flex flex-col bg-ih-bg-card rounded-xl border border-ih-border shadow-ih-popover">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-ih-border">
          <h2 className="text-[16px] font-bold">{m.new_inspection_title()}</h2>
          <button onClick={onClose} className="text-ih-fg-4 hover:text-ih-fg-2 text-lg leading-none">&times;</button>
        </div>

        {quotaExceeded !== undefined ? (
          <QuotaExceededPanel billingPortalUrl={quotaExceeded} onClose={onClose} />
        ) : (
        <>
        {/* Step indicator */}
        <div className="flex items-center gap-1 px-6 pt-4">
          {steps.map((s, i) => (
            <div key={s} className="flex items-center gap-1 flex-1">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold ${i <= stepIdx ? "bg-ih-primary text-white" : "bg-ih-bg-muted text-ih-fg-4"}`}>{i + 1}</div>
              <span className={`text-[11px] font-medium hidden sm:inline ${i <= stepIdx ? "text-ih-primary" : "text-ih-fg-4"}`}>{stepLabel(s)}</span>
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
              setAddress={handleAddressChange}
              onAddressSelect={handleAddressSelect}
              addressLat={addressSel?.lat}
              addressLng={addressSel?.lng}
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
              holidayFetcher={holidayFetcher}
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
            {stepIdx > 0 ? m.common_back() : m.common_cancel()}
          </button>
          {stepIdx < steps.length - 1 ? (
            <button disabled={!canNext} onClick={() => setStepIdx(stepIdx + 1)} className="h-8 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 disabled:opacity-40 disabled:cursor-not-allowed">
              {m.common_next()}
            </button>
          ) : (
            <button disabled={!canNext} onClick={handleSubmit} className="h-8 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 disabled:opacity-40 disabled:cursor-not-allowed">
              {m.new_inspection_create()}
            </button>
          )}
        </div>
        </>
        )}
    </div>
  );
}
