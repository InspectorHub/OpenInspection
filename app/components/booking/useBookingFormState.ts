import { useState, useMemo, useRef, useEffect } from "react";
import { useFetcher } from "react-router";
import type { CompanyProfile } from "./booking-constants";
import { m } from "~/paraglide/messages";

/** Where a returning visitor's own contact details are remembered (this device only). */
const REMEMBERED_CONTACT_KEY = "oi.booking.contact";

interface UseBookingFormStateArgs {
  profile: CompanyProfile | null;
  preselected: { id: string; name: string } | null;
  tenant: string | undefined;
  agentRefSlug: string | null;
  /** Set when a signed-in agent is booking on behalf of a client. */
  agentBooking?: { agentName: string; tenantId: string } | null;
}

export function useBookingFormState({ profile, preselected, tenant, agentRefSlug, agentBooking }: UseBookingFormStateArgs) {
  const [step, setStep] = useState(0);

  // Form state
  const [address, setAddress] = useState("");
  const [selectedServices, setSelectedServices] = useState<Set<string>>(new Set());
  const [inspectionDate, setInspectionDate] = useState("");
  const [timeWindow, setTimeWindow] = useState("morning");
  const [customTime, setCustomTime] = useState("09:00");
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  // Track L (D6, path A) — unchecked-by-default SMS opt-in (TCPA consent).
  const [smsOptin, setSmsOptin] = useState(false);
  // The language the client asked to be addressed in. Starts null and is only
  // ever set by them clicking an option: a default here would make every
  // booking look like a stated preference.
  const [locale, setLocale] = useState<string | null>(null);
  const [chosenInspectorId, setChosenInspectorId] = useState<string | null>(preselected?.id ?? null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileRef = useRef<HTMLDivElement>(null);

  // Repeat visitors re-typed their own name and email on every booking. Their
  // OWN contact details are remembered on this device only — never the address
  // or the services, which belong to one property, and never in an agent's
  // booking, where the fields hold someone else's client.
  const [prefilledFromDevice, setPrefilledFromDevice] = useState(false);
  const rememberContact = !agentBooking;
  useEffect(() => {
    if (!rememberContact) return;
    try {
      const raw = localStorage.getItem(REMEMBERED_CONTACT_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { name?: string; email?: string };
      if (!saved.name && !saved.email) return;
      setClientName((current) => current || saved.name || "");
      setClientEmail((current) => current || saved.email || "");
      setPrefilledFromDevice(true);
    } catch {
      // A malformed or blocked store just means no prefill.
    }
  }, [rememberContact]);

  /** "Not you?" — a different person on a shared device starts clean. */
  function clearRememberedContact() {
    try {
      localStorage.removeItem(REMEMBERED_CONTACT_KEY);
    } catch {
      // Nothing to do: the value was never readable in the first place.
    }
    setClientName("");
    setClientEmail("");
    setPrefilledFromDevice(false);
  }

  function saveRememberedContact() {
    if (!rememberContact) return;
    try {
      localStorage.setItem(REMEMBERED_CONTACT_KEY, JSON.stringify({ name: clientName, email: clientEmail }));
    } catch {
      // Private mode / storage disabled — booking still succeeded.
    }
  }

  const toggleService = (id: string) =>
    setSelectedServices((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const totalPrice = useMemo(() => {
    if (!profile) return 0;
    return profile.services
      .filter((s) => selectedServices.has(s.id))
      .reduce((sum, s) => sum + s.price / 100, 0);
  }, [selectedServices, profile]);

  // An authenticated agent is not an anonymous visitor, so the bot challenge
  // does not apply to them; every anonymous submit still faces it.
  const needsTurnstile = !!profile?.turnstileSiteKey && !agentBooking;
  const canNext =
    step === 0 ? address.length > 2 :
    step === 1 ? selectedServices.size > 0 :
    step === 2 ? inspectionDate.length > 0 && clientName.length > 0 && clientEmail.length > 0 :
    needsTurnstile ? !!turnstileToken : true;

  const inspectorOptions = useMemo(() => {
    const base = profile?.allowInspectorChoice && profile.inspectors.length > 0 ? [...profile.inspectors] : [];
    if (preselected && !base.some((i) => i.id === preselected.id)) {
      base.push({ id: preselected.id, name: preselected.name, photoUrl: null });
    }
    return base;
  }, [profile, preselected]);

  const chosenInspectorName = useMemo(() => {
    if (!chosenInspectorId) return m.helper_booking_inspector_first_available();
    const found = inspectorOptions.find((i) => i.id === chosenInspectorId);
    if (found) return found.name ?? m.helper_booking_inspector_default();
    return m.helper_booking_inspector_default();
  }, [chosenInspectorId, inspectorOptions]);

  // The agent branch submits through the route action: the hold endpoint is
  // authenticated and the session token never leaves the server side of this
  // app. The anonymous branch keeps posting to the public endpoint directly.
  const agentFetcher = useFetcher<{ ok?: boolean; error?: string }>();
  useEffect(() => {
    if (agentFetcher.state !== "idle" || !agentFetcher.data) return;
    if (agentFetcher.data.ok) {
      setMessage({ text: m.helper_booking_submit_success(), ok: true });
      setStep(3);
    } else {
      setMessage({ text: agentFetcher.data.error || m.helper_booking_submit_error(), ok: false });
    }
  }, [agentFetcher.state, agentFetcher.data]);

  function submitAgentHold() {
    const fd = new FormData();
    fd.append("_intent", "agent-book");
    fd.append("address", address);
    fd.append("date", inspectionDate);
    fd.append("timeSlot", timeWindow === "custom" ? customTime : timeWindow);
    if (chosenInspectorId) fd.append("inspectorId", chosenInspectorId);
    for (const id of selectedServices) fd.append("serviceId", id);
    fd.append("clientName", clientName);
    fd.append("clientEmail", clientEmail);
    agentFetcher.submit(fd, { method: "post" });
  }

  async function handleSubmit() {
    if (agentBooking) {
      submitAgentHold();
      return;
    }
    setSubmitting(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/public/book`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant,
          address,
          date: inspectionDate,
          timeSlot: timeWindow === "custom" ? "custom" : timeWindow,
          ...(timeWindow === "custom" ? { customTime } : {}),
          ...(chosenInspectorId ? { inspectorId: chosenInspectorId } : {}),
          services: [...selectedServices].map(id => ({ serviceId: id })),
          clientName,
          clientEmail,
          ...(smsOptin ? { smsOptin: true } : {}),
          // Omitted entirely when unanswered — the server stores NULL, which
          // is not the same as storing 'en'.
          ...(locale ? { locale } : {}),
          ...(turnstileToken ? { turnstileToken } : {}),
          ...(agentRefSlug ? { agentRefSlug } : {}),
        }),
      });
      if (res.ok) {
        saveRememberedContact();
        setMessage({ text: m.helper_booking_submit_success(), ok: true });
        setStep(3);
      } else {
        const d = await res.json().catch(() => ({}));
        setMessage({ text: (d as { error?: { message?: string } })?.error?.message || m.helper_booking_submit_error(), ok: false });
      }
    } catch {
      setMessage({ text: m.helper_booking_network_error(), ok: false });
    } finally {
      setSubmitting(false);
    }
  }

  return {
    step, setStep,
    address, setAddress,
    selectedServices,
    inspectionDate, setInspectionDate,
    timeWindow, setTimeWindow,
    customTime, setCustomTime,
    clientName, setClientName,
    clientEmail, setClientEmail,
    smsOptin, setSmsOptin,
    locale, setLocale,
    chosenInspectorId, setChosenInspectorId,
    submitting: submitting || agentFetcher.state === "submitting",
    message,
    turnstileToken, setTurnstileToken,
    turnstileRef,
    toggleService,
    totalPrice,
    needsTurnstile,
    canNext,
    inspectorOptions,
    chosenInspectorName,
    handleSubmit,
    tenant,
    prefilledFromDevice,
    clearRememberedContact,
    rememberContact,
  };
}
