import { useEffect, useMemo, useState } from "react";
import { useFetcher } from "react-router";
import { useContactSearch } from "~/hooks/useContactSearch";
import { useGuardedSubmit } from "~/hooks/useGuardedSubmit";
import { buildWizardSteps, stepBlockedReason, todayLocalISO, type WizardStepId } from "~/lib/wizard-steps";
import { summariseNewInspection } from "~/lib/wizard-review";
import { buildWizardCreatePayload } from "~/lib/wizard-submit";
import { PropertyStep } from "./new-inspection/PropertyStep";
import { PeopleStep } from "./new-inspection/PeopleStep";
import { ServicesStep } from "./new-inspection/ServicesStep";
import { ConfirmStep } from "./new-inspection/ConfirmStep";
import { ReviewPanel } from "./new-inspection/ReviewPanel";
import { WizardLayout } from "./new-inspection/WizardLayout";
import { Breadcrumb } from "./Breadcrumb";
import { PageHeader } from "@core/shared-ui";
import { civilToInstantISO } from "~/lib/civil-time";
import { useDisplayTimeZone, useSessionContext } from "~/hooks/useSessionContext";
import { QuotaExceededPanel } from "./new-inspection/QuotaExceededPanel";
import type { AddressSelection } from "~/routes/resources/places";
import { m } from "~/paraglide/messages";

function stepLabel(id: WizardStepId): string {
  switch (id) {
    case "property": return m.new_inspection_step_property();
    case "people": return m.new_inspection_step_people();
    case "services": return m.new_inspection_step_services();
    case "confirm": return m.new_inspection_step_confirm();
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

/** Client row returned by the search-clients action intent. Carries a phone the agent search has no use for. */
export interface ClientResult {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
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
  // portal #105 — the create submit is guarded, not bare: one in-flight submit
  // at a time, carrying an idempotency key the server dedupes on. A tenant
  // created three byte-identical inspections seconds apart because Create was a
  // plain `fetcher.submit` behind a button that stayed live.
  const { fetcher, submit: submitCreate, busy: creating } = useGuardedSubmit();
  // The zone the Schedule step names, and the zone the typed time is read in.
  // Both must be the same value or the inspector is told one thing and the
  // booking stores another.
  const displayTz = useDisplayTimeZone();
  const sessionCtx = useSessionContext();
  // IA-1 agent typeahead, and (Batch D) the same search for the client — one
  // hook, two instances, each with its own fetcher.
  const [agentSearch, setAgentSearch] = useState("");
  const agentSearchCtl = useContactSearch<{ intent: "search-agents"; agents: AgentResult[] }>(
    "search-agents",
    setAgentSearch,
  );
  const [clientName, setClientName] = useState("");
  /** Set when the client fields were filled from a Contacts hit; cleared on any
   *  hand edit, since the values are then no longer that contact's. */
  const [pickedClientId, setPickedClientId] = useState<string | null>(null);
  // The client's search box IS the name field — there is no separate query to
  // keep, and typing a name nobody has on file is still a valid answer.
  const clientSearchCtl = useContactSearch<{ intent: "search-clients"; clients: ClientResult[] }>(
    "search-clients",
    (value) => {
      setClientName(value);
      setPickedClientId(null);
    },
  );
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

  // IA-1 People step state (clientName lives with its search hook above)
  const [clientEmail, setClientEmail] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  // Agent: either a selected existing contact or inline-new mode.
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
  // Batch D — Schedule and Team merged into `confirm`, which also reviews.
  const steps = useMemo(() => buildWizardSteps({ hasServiceCatalog }), [hasServiceCatalog]);
  const step: WizardStepId = steps[Math.min(stepIdx, steps.length - 1)];

  // What the final step states back before Create is pressed.
  const summary = useMemo(
    () =>
      summariseNewInspection({
        address,
        templates,
        templateId,
        clientName,
        clientEmail,
        clientPhone,
        selectedAgent,
        newAgentName,
        serviceCatalog,
        selectedServiceIds: [...services],
        priceOverrides,
        soloMode,
        inspectorId,
        teamMembers,
        selfName: sessionCtx?.user.name ?? null,
      }),
    [address, templates, templateId, clientName, clientEmail, clientPhone, selectedAgent,
      newAgentName, serviceCatalog, services, priceOverrides, soloMode, inspectorId, teamMembers,
      sessionCtx],
  );

  useEffect(() => {
    if (!open) {
      setStepIdx(0);
      setPropertyType("single_family");
      setAddress("");
      setAddressSel(null);
      setTemplateId("");
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
      clientSearchCtl.setDropdownOpen(false);
      setAgentSearch("");
      agentSearchCtl.setDropdownOpen(false);
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
    const combinedDate = civilToInstantISO(date, time, displayTz);
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

  function selectClient(client: ClientResult) {
    // Fill all three fields: the create endpoint deduplicates the contact by
    // email, so carrying it over is what links this inspection to the existing
    // client instead of making a second row with the same name.
    setClientName(client.name);
    setClientEmail(client.email ?? "");
    setClientPhone(client.phone ?? "");
    // Remember that these three values came from a contact. Picking an existing
    // client and typing a new one left the fields looking identical, and they
    // mean different things — one joins a history, the other starts one.
    setPickedClientId(client.id);
    clientSearchCtl.setDropdownOpen(false);
  }

  function selectAgent(agent: AgentResult) {
    setSelectedAgent(agent);
    setAgentSearch("");
    agentSearchCtl.setDropdownOpen(false);
    setNewAgentMode(false);
    setNewAgentName("");
    setNewAgentEmail("");
  }

  function clearAgent() {
    setSelectedAgent(null);
    setAgentSearch("");
    agentSearchCtl.setDropdownOpen(false);
  }

  function enableNewAgentMode() {
    setNewAgentMode(true);
    setSelectedAgent(null);
    setAgentSearch("");
    agentSearchCtl.setDropdownOpen(false);
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

  // A single source for both "may we advance" and "why not" — the button was
  // disabled with no explanation, twice in one wizard.
  const blockedReason = stepBlockedReason(step, {
    address,
    templateId,
    clientNameMissing,
    serviceCount: services.size,
    date,
    holidayBlocked: holidayFetcher.data?.effect === "block",
  });

  function handleSubmit() {
    // Returns false and does nothing if a create is already in flight — the
    // button below is disabled too, but that only takes effect on the NEXT
    // render, which a double click beats.
    submitCreate(
      buildWizardCreatePayload({
        propertyType,
        address,
        addressSel,
        templateId,
        serviceIds: [...services],
        priceOverrides,
        date,
        time,
        timeZone: displayTz,
        soloMode,
        inspectorId,
        clientName,
        clientEmail,
        clientPhone,
        selectedAgentId: selectedAgent?.id ?? null,
        newAgentName,
        newAgentEmail,
      }),
      { method: "post", action: "/inspections" },
    );
    // Closing happens once the fetcher settles (see the effect above) — a
    // QUOTA_EXHAUSTED rejection keeps the wizard open to show the upgrade
    // panel instead of closing immediately on submit.
  }

  if (quotaExceeded !== undefined) {
    return (
      <div className="w-full">
        <Breadcrumb items={[{ label: m.nav_item_inspections(), href: "/inspections" }, { label: m.new_inspection_title() }]} />
        <div className="mt-1"><PageHeader title={m.new_inspection_title()} /></div>
        <div className="mt-ih-list max-w-[720px] bg-ih-bg-card rounded-xl border border-ih-border">
          <QuotaExceededPanel billingPortalUrl={quotaExceeded} onClose={onClose} />
        </div>
      </div>
    );
  }

  return (
    <WizardLayout
      steps={steps}
      stepIdx={stepIdx}
      stepLabel={stepLabel}
      blockedReason={blockedReason}
      busy={creating}
      isLastStep={stepIdx === steps.length - 1}
      onBack={() => (stepIdx > 0 ? setStepIdx(stepIdx - 1) : onClose())}
      onNext={() => (stepIdx < steps.length - 1 ? setStepIdx(stepIdx + 1) : handleSubmit())}
      review={
        <ReviewPanel
          summary={summary}
          scheduledIso={civilToInstantISO(date, time, displayTz)}
          timeZone={displayTz}
          currentStep={step}
          onJump={(target) => {
            const idx = steps.indexOf(target);
            if (idx >= 0) setStepIdx(idx);
          }}
        />
      }
    >
        <div>
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
            />
          )}

          {step === "people" && (
            <PeopleStep
              clientName={clientName}
              clientSearch={clientSearchCtl}
              selectClient={selectClient}
              clientEmail={clientEmail}
              setClientEmail={(v) => {
                setClientEmail(v);
                setPickedClientId(null);
              }}
              clientIsExistingContact={pickedClientId !== null}
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
              agentSearchCtl={agentSearchCtl}
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

          {step === "confirm" && (
            <ConfirmStep
              date={date}
              setDate={setDate}
              time={time}
              setTime={setTime}
              timeZone={displayTz}
              conflictFetcher={conflictFetcher}
              holidayFetcher={holidayFetcher}
              showTeam={teamMembers.length > 0}
              soloMode={soloMode}
              setSoloMode={setSoloMode}
              inspectorId={inspectorId}
              setInspectorId={setInspectorId}
              teamMembers={teamMembers}
            />
          )}
        </div>
    </WizardLayout>
  );
}
