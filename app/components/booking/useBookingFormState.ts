import { useState, useMemo, useRef } from "react";
import type { CompanyProfile } from "./booking-constants";

interface UseBookingFormStateArgs {
  profile: CompanyProfile | null;
  preselected: { id: string; name: string } | null;
  tenant: string | undefined;
  agentRefSlug: string | null;
}

export function useBookingFormState({ profile, preselected, tenant, agentRefSlug }: UseBookingFormStateArgs) {
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
  const [chosenInspectorId, setChosenInspectorId] = useState<string | null>(preselected?.id ?? null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileRef = useRef<HTMLDivElement>(null);

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

  const needsTurnstile = !!profile?.turnstileSiteKey;
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
    if (!chosenInspectorId) return "First available";
    const found = inspectorOptions.find((i) => i.id === chosenInspectorId);
    if (found) return found.name ?? "Inspector";
    return "Inspector";
  }, [chosenInspectorId, inspectorOptions]);

  async function handleSubmit() {
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
          ...(turnstileToken ? { turnstileToken } : {}),
          ...(agentRefSlug ? { agentRefSlug } : {}),
        }),
      });
      if (res.ok) {
        setMessage({ text: "Booking request submitted! You will receive a confirmation email shortly.", ok: true });
        setStep(3);
      } else {
        const d = await res.json().catch(() => ({}));
        setMessage({ text: (d as { error?: { message?: string } })?.error?.message || "Something went wrong. Please try again.", ok: false });
      }
    } catch {
      setMessage({ text: "Network error. Please check your connection.", ok: false });
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
    chosenInspectorId, setChosenInspectorId,
    submitting,
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
  };
}
