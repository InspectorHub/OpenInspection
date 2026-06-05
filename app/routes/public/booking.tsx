import { useState, useMemo, useEffect, useRef } from "react";
import { useLoaderData } from "react-router";
import type { Route } from "./+types/booking";
import { createApi } from "~/lib/api-client.server";
import { resolveTenantBrand } from "~/lib/tenant-brand.server";
import { brandTokens, EMPTY_BRAND, type TenantBrand } from "~/lib/brand";
import { readLegalLinks } from "~/lib/legal-links.server";

declare global {
  interface Window {
    onTurnstileLoad?: () => void;
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: { sitekey: string; callback: (token: string) => void },
      ) => void;
    };
  }
}

export function meta() {
  return [{ title: "Book an Inspection - OpenInspection" }];
}

interface InspectorProfile {
  inspectorId: string;
  name: string;
  company?: string;
  avatar?: string;
  turnstileSiteKey?: string | null;
  bookingOpen?: boolean;
  services: { id: string; name: string; price: number; duration: number }[];
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  // F7 — capture agent referral slug from ?ref= query parameter
  const url = new URL(request.url);
  const refRaw = url.searchParams.get("ref");
  const agentRefSlug =
    refRaw && /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(refRaw)
      ? refRaw
      : null;

  try {
    const api = createApi(context);
    const [res, brand] = await Promise.all([
      api.bookings.book[":tenant"][":slug"].$get({
        param: { tenant: params.tenant ?? "", slug: params.slug ?? "" },
      }),
      resolveTenantBrand(context, params.tenant),
    ]);
    const body = res.ok ? await res.json() : {};
    const d = ((body as Record<string, unknown>).data ?? {}) as Record<string, unknown>;
    const legal = readLegalLinks(context);
    return {
      profile: (Object.keys(d).length > 0 ? d : null) as InspectorProfile | null,
      error: res.ok ? null : "Inspector not found",
      tenant: params.tenant,
      slug: params.slug,
      agentRefSlug,
      brand,
      privacyUrl: legal?.privacyUrl ?? null,
    };
  } catch {
    return { profile: null, error: "Service unavailable", tenant: "", slug: "", agentRefSlug: null, brand: EMPTY_BRAND as TenantBrand, privacyUrl: null };
  }
}

/* ------------------------------------------------------------------ */
/*  Multi-step booking wizard                                          */
/* ------------------------------------------------------------------ */

const STEPS = ["Property", "Services", "Schedule", "Confirm"] as const;

const TIME_WINDOWS = [
  { id: "morning", label: "Morning", detail: "8:00 AM - 12:00 PM" },
  { id: "afternoon", label: "Afternoon", detail: "12:00 PM - 5:00 PM" },
  // id must match the API timeSlot enum ('all-day', not 'allday')
  { id: "all-day", label: "All Day", detail: "Flexible timing" },
  { id: "custom", label: "Custom", detail: "Pick a specific time" },
] as const;

export default function BookingPage() {
  const { profile, error, agentRefSlug, brand, tenant, privacyUrl } = useLoaderData<typeof loader>();
  const [step, setStep] = useState(0);

  // Form state
  const [address, setAddress] = useState("");
  const [selectedServices, setSelectedServices] = useState<Set<string>>(new Set());
  const [inspectionDate, setInspectionDate] = useState("");
  const [timeWindow, setTimeWindow] = useState("morning");
  const [customTime, setCustomTime] = useState("09:00");
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileRef = useRef<HTMLDivElement>(null);

  // Load Turnstile widget
  useEffect(() => {
    const siteKey = profile?.turnstileSiteKey;
    if (!siteKey || typeof window === "undefined") return;
    const existing = document.querySelector('script[src*="turnstile"]');
    if (!existing) {
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad";
      s.async = true;
      document.head.appendChild(s);
    }
    window.onTurnstileLoad = () => {
      if (turnstileRef.current && window.turnstile) {
        window.turnstile.render(turnstileRef.current, {
          sitekey: siteKey,
          callback: (token: string) => setTurnstileToken(token),
        });
      }
    };
    if (window.turnstile && turnstileRef.current) {
      window.turnstile.render(turnstileRef.current, {
        sitekey: siteKey,
        callback: (token: string) => setTurnstileToken(token),
      });
    }
  }, [profile?.turnstileSiteKey, step]);

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
          inspectorId: profile?.inspectorId,
          services: [...selectedServices].map(id => ({ serviceId: id })),
          clientName,
          clientEmail,
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

  if (error || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ih-bg-app">
        <div className="text-center p-8">
          <h1 className="text-2xl font-bold text-ih-fg-1">Not Available</h1>
          <p className="text-ih-fg-3 mt-2">
            {error ?? "This booking page is not available."}
          </p>
        </div>
      </div>
    );
  }

  // B-16 — the inspector hasn't configured working hours yet: show an honest
  // not-open state instead of a wizard whose submit can only fail.
  if (profile.bookingOpen === false) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ih-bg-app" style={brandTokens(brand.primaryColor)}>
        <div className="max-w-md text-center p-8 bg-ih-bg-card border border-ih-border rounded-xl">
          <h1 className="text-xl font-bold text-ih-fg-1">Online booking isn&rsquo;t open yet</h1>
          <p className="text-[14px] text-ih-fg-3 mt-3 leading-relaxed">
            {profile.name} hasn&rsquo;t opened online scheduling. Please contact{" "}
            {profile.company ? `${profile.company}` : "them"} directly to book your inspection.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ih-bg-app py-12 px-4" style={brandTokens(brand.primaryColor)}>
      <div className="max-w-2xl mx-auto">
        {/* Inspector header */}
        <nav className="mb-8 flex items-center gap-3">
          {brand.logoUrl ? (
            <img src={brand.logoUrl} alt={brand.siteName ?? profile.company ?? "Logo"} className="h-10 w-auto" />
          ) : (
            <div className="w-10 h-10 rounded-full bg-ih-primary-tint flex items-center justify-center text-ih-primary text-lg font-bold">
              {profile.name.charAt(0)}
            </div>
          )}
          <div>
            <p className="text-[15px] font-semibold text-ih-fg-1">{profile.name}</p>
            {profile.company && (
              <p className="text-[12px] text-ih-fg-3">{profile.company}</p>
            )}
          </div>
        </nav>

        <div className="bg-ih-bg-card rounded-lg shadow-ih-card border border-ih-border p-6 md:p-10">
          <div className="mb-8 space-y-2">
            <h1 className="text-[28px] font-semibold tracking-tight text-ih-fg-1 leading-tight">
              Schedule an inspection
            </h1>
            <p className="text-[14px] text-ih-fg-3 leading-relaxed">
              Tell us about the property and pick a time that works.
            </p>
          </div>

          {/* Step indicator */}
          <div className="flex items-center gap-1 mb-8">
            {STEPS.map((s, i) => (
              <div key={s} className="flex items-center gap-1 flex-1">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold ${
                  i <= step
                    ? "bg-ih-primary text-white"
                    : "bg-ih-bg-muted text-ih-fg-4"
                }`}>{i + 1}</div>
                <span className={`text-[11px] font-medium hidden sm:inline ${
                  i <= step ? "text-ih-primary" : "text-ih-fg-4"
                }`}>{s}</span>
                {i < STEPS.length - 1 && (
                  <div className={`flex-1 h-px mx-1 ${i < step ? "bg-ih-primary" : "bg-ih-bg-muted"}`} />
                )}
              </div>
            ))}
          </div>

          {/* Step 0: Property */}
          {step === 0 && (
            <section className="space-y-5">
              <div className="space-y-1">
                <h2 className="text-[18px] font-semibold tracking-tight text-ih-fg-1">Property</h2>
                <p className="text-[13px] text-ih-fg-3">Where is the inspection?</p>
              </div>
              <label className="block">
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3">Property address</span>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="123 Main St, City, State ZIP"
                  autoFocus
                  className="mt-1 w-full h-10 px-3 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none text-[14px] font-medium transition-colors"
                />
              </label>
            </section>
          )}

          {/* Step 1: Services */}
          {step === 1 && (
            <section className="space-y-5">
              <div className="space-y-1">
                <h2 className="text-[18px] font-semibold tracking-tight text-ih-fg-1">Services</h2>
                <p className="text-[13px] text-ih-fg-3">Choose one or more inspections for this visit.</p>
              </div>
              <div className="space-y-2">
                {profile.services.map((svc) => {
                  const selected = selectedServices.has(svc.id);
                  return (
                    <label key={svc.id} className="block cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleService(svc.id)}
                        className="sr-only"
                      />
                      <div className={`px-4 py-3 rounded-md border transition-all flex items-center justify-between gap-3 ${
                        selected
                          ? "border-ih-primary bg-ih-primary-tint ring-2 ring-ih-primary/10"
                          : "border-ih-border bg-ih-bg-card hover:border-ih-border-strong"
                      }`}>
                        <div className="min-w-0">
                          <div className="text-[13px] font-bold text-ih-fg-1 truncate">{svc.name}</div>
                          <div className="text-[11px] text-ih-fg-3 mt-0.5">
                            ~{svc.duration} min
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-sm font-semibold text-ih-fg-1">${(svc.price / 100).toFixed(2)}</span>
                          {selected && (
                            <svg className="w-4 h-4 text-ih-primary" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          )}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
              {selectedServices.size > 0 && (
                <div className="px-4 py-2 rounded-md bg-ih-bg-muted flex items-center justify-between">
                  <span className="text-[12px] font-bold text-ih-fg-3">
                    {selectedServices.size} {selectedServices.size === 1 ? "inspection" : "inspections"}
                  </span>
                  <span className="text-[15px] font-bold text-ih-fg-1 tabular-nums">
                    ${totalPrice.toFixed(2)}
                  </span>
                </div>
              )}
            </section>
          )}

          {/* Step 2: Schedule + contact info */}
          {step === 2 && (
            <section className="space-y-8">
              <div className="space-y-5">
                <div className="space-y-1">
                  <h2 className="text-[18px] font-semibold tracking-tight text-ih-fg-1">Schedule</h2>
                  <p className="text-[13px] text-ih-fg-3">Pick a date and time window that works.</p>
                </div>
                <label className="block">
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3">Inspection date</span>
                  <input
                    type="date"
                    value={inspectionDate}
                    onChange={(e) => setInspectionDate(e.target.value)}
                    className="mt-1 w-full h-10 px-3 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none text-[14px] font-medium tabular-nums transition-colors"
                  />
                </label>
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3">Time window</span>
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    {TIME_WINDOWS.map((w) => (
                      <label key={w.id} className="cursor-pointer">
                        <input type="radio" name="timeSlot" value={w.id} checked={timeWindow === w.id} onChange={() => setTimeWindow(w.id)} className="sr-only" />
                        <div className={`px-3 py-2.5 rounded-md border transition-all ${
                          timeWindow === w.id
                            ? "border-ih-primary bg-ih-primary-tint ring-2 ring-ih-primary/10"
                            : "border-ih-border bg-ih-bg-card"
                        }`}>
                          <div className="text-[13px] font-bold text-ih-fg-1">{w.label}</div>
                          <div className="text-[11px] text-ih-fg-3 mt-0.5">{w.detail}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                  {timeWindow === "custom" && (
                    <div className="mt-3 flex items-center gap-2">
                      <input
                        type="time"
                        value={customTime}
                        onChange={(e) => setCustomTime(e.target.value)}
                        className="h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none text-[13px] font-medium tabular-nums"
                      />
                      <span className="text-[11px] text-ih-fg-4">on selected date</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-5">
                <div className="space-y-1">
                  <h2 className="text-[18px] font-semibold tracking-tight text-ih-fg-1">Your info</h2>
                  <p className="text-[13px] text-ih-fg-3">How do we reach you with the report?</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label className="block">
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3">Full name</span>
                    <input
                      type="text"
                      value={clientName}
                      onChange={(e) => setClientName(e.target.value)}
                      placeholder="Jane Doe"
                      className="mt-1 w-full h-10 px-3 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none text-[14px] font-medium transition-colors"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3">Email</span>
                    <input
                      type="email"
                      value={clientEmail}
                      onChange={(e) => setClientEmail(e.target.value)}
                      placeholder="jane@example.com"
                      className="mt-1 w-full h-10 px-3 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none text-[14px] font-medium transition-colors"
                    />
                  </label>
                </div>
              </div>
            </section>
          )}

          {/* Step 3: Confirm */}
          {step === 3 && (
            <section className="space-y-5">
              {message?.ok ? (
                <div className="text-center py-8">
                  <div className="w-16 h-16 rounded-full bg-ih-ok-bg flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-ih-ok-fg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <h2 className="text-xl font-bold text-ih-fg-1 mb-2">Request Submitted</h2>
                  <p className="text-[14px] text-ih-fg-3">{message.text}</p>
                </div>
              ) : (
                <>
                  <div className="space-y-1">
                    <h2 className="text-[18px] font-semibold tracking-tight text-ih-fg-1">Confirm details</h2>
                    <p className="text-[13px] text-ih-fg-3">Review your booking before submitting.</p>
                  </div>
                  <div className="bg-ih-bg-muted rounded-md p-4 space-y-3 text-[13px]">
                    <div className="flex justify-between">
                      <span className="text-ih-fg-3">Address</span>
                      <span className="font-medium text-ih-fg-1">{address}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ih-fg-3">Date</span>
                      <span className="font-medium text-ih-fg-1">{inspectionDate}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ih-fg-3">Time</span>
                      <span className="font-medium text-ih-fg-1">
                        {timeWindow === "custom" ? customTime : TIME_WINDOWS.find((w) => w.id === timeWindow)?.label}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ih-fg-3">Services</span>
                      <span className="font-medium text-ih-fg-1">{selectedServices.size} selected</span>
                    </div>
                    <div className="flex justify-between border-t border-ih-border pt-3">
                      <span className="font-bold text-ih-fg-2">Total</span>
                      <span className="font-bold text-ih-fg-1">${totalPrice.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ih-fg-3">Name</span>
                      <span className="font-medium text-ih-fg-1">{clientName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ih-fg-3">Email</span>
                      <span className="font-medium text-ih-fg-1">{clientEmail}</span>
                    </div>
                  </div>
                </>
              )}
            </section>
          )}

          {/* Turnstile — shown on confirm step */}
          {step === 3 && needsTurnstile && (
            <div className="mt-6 flex justify-center">
              <div ref={turnstileRef} />
            </div>
          )}

          {/* Message display */}
          {message && !message.ok && (
            <div className="mt-6 p-3 rounded-md bg-ih-bad-bg text-center text-[13px] font-semibold text-ih-bad-fg">
              {message.text}
            </div>
          )}

          {/* Navigation footer */}
          {!(step === 3 && message?.ok) && (
            <div className="flex items-center justify-between mt-8 pt-6 border-t border-ih-border">
              <button
                onClick={() => step > 0 ? setStep(step - 1) : undefined}
                disabled={step === 0}
                className="h-9 px-4 rounded-md border border-ih-border text-[13px] font-medium text-ih-fg-3 hover:bg-ih-bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                Back
              </button>
              {step < 3 ? (
                <button
                  onClick={() => setStep(step + 1)}
                  disabled={!canNext}
                  className="h-9 px-5 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Continue
                </button>
              ) : (
                <div className="text-right">
                  <p className="mb-2 text-xs text-ih-fg-3">
                    Your information is shared with {profile.company ?? profile.name} to schedule your inspection.
                    {privacyUrl && <> See our <a href={privacyUrl} target="_blank" rel="noreferrer" className="underline">Privacy Policy</a>.</>}
                  </p>
                  <button
                    onClick={handleSubmit}
                    disabled={submitting || (needsTurnstile && !turnstileToken)}
                    className="h-9 px-5 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {submitting ? "Submitting..." : "Request Inspection"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <p className="text-center text-[11px] text-ih-fg-4 mt-6">
          Powered by OpenInspection
        </p>
        {privacyUrl && (
          <p className="mt-8 text-center text-xs text-ih-fg-3">
            <a href={privacyUrl} target="_blank" rel="noreferrer" className="hover:underline">Privacy Policy</a>
          </p>
        )}
      </div>
    </div>
  );
}
