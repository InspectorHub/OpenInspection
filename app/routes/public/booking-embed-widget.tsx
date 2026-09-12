import { useEffect, useRef, useState } from "react";
import { brandTokens, type TenantBrand } from "~/lib/brand";
import { useTurnstileWidget } from "~/lib/turnstile";
import { LanguageChoice } from "~/components/booking/LanguageChoice";
import { BOOKING_HORIZON_DAYS, addDaysCivil, todayCivil } from "~/components/booking/booking-date-rules";
import { m } from "~/paraglide/messages";

/* ------------------------------------------------------------------ */
/*  Shared embed widget                                                */
/* ------------------------------------------------------------------ */
/*
 * The booking embed is company-level only (booking-embed-company.tsx): the
 * server auto-assigns the first available qualified inspector. This module is
 * the shared presentation the route renders — a plain component library, not a
 * route itself. The per-inspector embed route (`/embed/:tenant/:slug`) was
 * retired along with the other per-inspector booking URL forms.
 */

export interface EmbedData {
  /** Inspector slug, or "" for company-level auto-assign. */
  slug: string;
  /** Inspector UUID, or "" for company-level auto-assign. */
  inspectorId: string;
  /** Company name for the company embed. */
  inspectorName: string;
  tenantSlug: string;
  /**
   * Turnstile site key from `resolveTurnstileSiteKey`, or "" when this
   * deployment challenges nobody. Empty is a real state, not a missing one:
   * a standalone operator with no secret configured gets `enforced: false`
   * server-side, and the form must submit with nothing attached.
   */
  siteKey: string;
  theme: "light" | "dark" | "branded";
  brand: TenantBrand | null;
  bookingOpen: boolean;
  privacyUrl: string | null;
  termsUrl?: string | null;
}

export function EmbedWizard({
  data,
  error,
}: {
  data: EmbedData | null;
  error: string | null;
}) {
  useEffect(() => {
    if (typeof document === "undefined") return;
    const isDark = data && data.theme === "dark";
    document.documentElement.setAttribute("data-color-scheme", isDark ? "dark" : "light");
    if (isDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [data]);

  if (error || !data) {
    return (
      <div style={{ padding: 16 }}>
        <p style={{ color: "#64748b", fontSize: 13 }}>{m.booking_embed_unavailable()}</p>
      </div>
    );
  }

  return (
    <div
      className="p-4"
      style={data.theme === "branded" ? brandTokens(data.brand?.primaryColor) : undefined}
    >
      <div className="bg-ih-bg-card border border-ih-border rounded-xl p-5">
        {data.theme === "branded" && data.brand?.logoUrl && (
          <img
            src={data.brand.logoUrl}
            alt={data.brand.companyName ?? m.booking_logo_alt()}
            className="h-7 w-auto mb-3"
          />
        )}
        <h2 className="text-base font-bold text-ih-fg-1 mb-1">
          {m.booking_embed_book_with_heading({ name: data.inspectorName })}
        </h2>
        {data.bookingOpen ? (
          <>
            <p className="text-[13px] text-ih-fg-3 mb-4">
              {m.booking_embed_confirm_by_email()}
            </p>
            <BookingForm data={data} privacyUrl={data.privacyUrl} />
          </>
        ) : (
          // B-16 — no working hours configured: honest not-open state.
          <div>
            <p className="text-[13px] text-ih-fg-3">
              {m.booking_embed_not_open({ name: data.inspectorName })}
            </p>
            {(data.privacyUrl || data.termsUrl) && (
              <p className="mt-4 text-center text-[11px] text-ih-fg-3">
                {data.privacyUrl && (
                  <a href={data.privacyUrl} target="_blank" rel="noreferrer" className="hover:underline">
                    {m.booking_link_privacy_policy()}
                  </a>
                )}
                {data.privacyUrl && data.termsUrl && <span className="mx-1.5">·</span>}
                {data.termsUrl && (
                  <a href={data.termsUrl} target="_blank" rel="noreferrer" className="hover:underline">
                    {m.legal_checkbox_terms()}
                  </a>
                )}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Booking form fragment                                              */
/* ------------------------------------------------------------------ */

function BookingForm({ data, privacyUrl }: { data: EmbedData; privacyUrl: string | null }) {
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(null);

  /**
   * The bot challenge this form never had.
   *
   * `data.siteKey` was resolved by the loader and then read by nobody, while
   * the submit posted `fd.get("cf-turnstile-response")` — always null, because
   * no widget had ever written that input. The server meanwhile demands a
   * token on every saas deployment (`resolveTurnstile` reports `enforced`
   * unconditionally there), so this form answered 403 on the hosted product
   * rather than being merely unprotected.
   *
   * Empty `siteKey` means the deployment challenges nobody — the standalone
   * default. Then nothing is mounted and nothing is demanded, matching what
   * `admitBooking` will do.
   */
  const needsTurnstile = !!data.siteKey;
  const turnstileRef = useRef<HTMLDivElement>(null);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifyUnavailable, setVerifyUnavailable] = useState(false);

  useTurnstileWidget(
    data.siteKey || null,
    turnstileRef,
    // The main wizard passes its step here so the widget re-renders when the
    // host element remounts. This form is one screen and never remounts it.
    0,
    setTurnstileToken,
    {
      onLoadFailed: () => setVerifyUnavailable(true),
      // The embed's palette is the HOST site's `?style=`, not the visitor's.
      // It does reach `<html data-color-scheme>`, but from an effect in
      // EmbedWizard — a parent, whose effect runs after this child's — so
      // deriving it here would read the previous value. `branded` renders
      // light with the tenant's accent tokens; Turnstile has no third option.
      theme: data.theme === "dark" ? "dark" : "light",
    },
  );
  // Not part of the FormData sweep below: a radio group with nothing selected
  // submits no entry at all, and "absent" would then be indistinguishable from
  // "the field is not on this form". Held in state so the unanswered case is
  // explicit.
  const [locale, setLocale] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    // Enabled-and-explain, as on the main booking form: a submit that sits
    // dead with no reason is worse than one that acts and reports. Refusing
    // here also spares the visitor a 403 they could not have interpreted.
    if (needsTurnstile && !turnstileToken) {
      setVerifyError(
        verifyUnavailable ? m.booking_verify_unavailable() : m.booking_verify_required(),
      );
      return;
    }
    setVerifyError(null);
    setSubmitting(true);
    setStatus(null);

    const fd = new FormData(e.currentTarget);
    try {
      // Omit inspectorId when empty so the server auto-assigns.
      const inspectorId = fd.get("inspectorId") || "";
      // `embed=1` is how `admitBooking` knows to apply the tenant's widget
      // origin allowlist. Without it that block was unreachable and the
      // allowlist had never run for a booking. The server enforces only a
      // list a tenant actually configured, so saying so locks nobody out.
      const res = await fetch("/api/public/book?embed=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant: data.tenantSlug,
          slug: fd.get("slug") || undefined,
          ...(inspectorId ? { inspectorId } : {}),
          address: fd.get("address"),
          clientName: fd.get("clientName"),
          clientEmail: fd.get("clientEmail"),
          clientPhone: fd.get("clientPhone") || undefined,
          date: fd.get("date"),
          // The embed has no time picker — the API requires a timeSlot, and
          // 'all-day' is the honest default (server collapses it internally).
          timeSlot: "all-day",
          // NO `services`, and therefore NO DEPOSIT from this surface, even for
          // a workspace that requires one. Not an oversight and not a quick fix:
          // a deposit resolves against the price of what was selected, and this
          // form selects nothing — the order it creates carries `price: 0`. A
          // percentage of zero is zero, and a flat amount against an order with
          // no priced work is a charge with nothing behind it. Giving the embed
          // a deposit means giving it service selection first. Tracked as its
          // own issue; see the booking-deposit plan, Risk 3.
          ...(locale ? { locale } : {}),
          turnstileToken: turnstileToken || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && (json as Record<string, unknown>).success) {
        setStatus({ text: m.booking_embed_status_success(), ok: true });
        // Notify parent iframe
        window.parent?.postMessage(
          { type: "oi-embed", kind: "success", slug: data.slug },
          "*",
        );
      } else {
        const err = (json as Record<string, Record<string, string>>)?.error;
        setStatus({ text: err?.message || m.booking_embed_status_could_not_submit(), ok: false });
      }
    } catch {
      setStatus({ text: m.booking_embed_status_network_error(), ok: false });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <input type="hidden" name="slug" value={data.slug} />
      <input type="hidden" name="inspectorId" value={data.inspectorId} />

      <div className="mb-3">
        <label className="block text-[11px] font-bold uppercase tracking-wide text-ih-fg-3 mb-1">
          {m.booking_field_address_label()}
        </label>
        <input
          type="text"
          name="address"
          required
          placeholder={m.booking_embed_address_placeholder()}
          className="w-full px-2.5 py-2 border border-ih-border rounded-md text-sm bg-ih-bg-card text-ih-fg-1 outline-none focus:border-ih-primary focus:shadow-ih-focus"
        />
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wide text-ih-fg-3 mb-1">
            {m.booking_embed_name_label()}
          </label>
          <input
            type="text"
            name="clientName"
            required
            placeholder={m.booking_placeholder_name()}
            className="w-full px-2.5 py-2 border border-ih-border rounded-md text-sm bg-ih-bg-card text-ih-fg-1 outline-none focus:border-ih-primary focus:shadow-ih-focus"
          />
        </div>
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wide text-ih-fg-3 mb-1">
            {m.booking_field_email_label()}
          </label>
          <input
            type="email"
            name="clientEmail"
            required
            placeholder={m.booking_placeholder_email()}
            className="w-full px-2.5 py-2 border border-ih-border rounded-md text-sm bg-ih-bg-card text-ih-fg-1 outline-none focus:border-ih-primary focus:shadow-ih-focus"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wide text-ih-fg-3 mb-1">
            {m.booking_embed_phone_label()}
          </label>
          <input
            type="tel"
            name="clientPhone"
            placeholder={m.booking_embed_phone_placeholder()}
            className="w-full px-2.5 py-2 border border-ih-border rounded-md text-sm bg-ih-bg-card text-ih-fg-1 outline-none focus:border-ih-primary focus:shadow-ih-focus"
          />
        </div>
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wide text-ih-fg-3 mb-1">
            {m.booking_embed_date_label()}
          </label>
          <input
            type="date"
            name="date"
            required
            // F42 — the widget posts to the same endpoint as the full page, and
            // that endpoint now refuses a date in the past. Giving the picker the
            // same range means the visitor is stopped by the calendar rather than
            // by a server error on a one-screen form.
            min={todayCivil()}
            max={addDaysCivil(todayCivil(), BOOKING_HORIZON_DAYS)}
            className="w-full px-2.5 py-2 border border-ih-border rounded-md text-sm bg-ih-bg-card text-ih-fg-1 outline-none focus:border-ih-primary focus:shadow-ih-focus"
          />
        </div>
      </div>

      <div className="mb-4">
        <LanguageChoice
          value={locale}
          onChange={setLocale}
          name="embed-locale"
          legendClassName="block text-[11px] font-bold uppercase tracking-wide text-ih-fg-3 mb-1"
        />
      </div>

      <p className="mb-2 text-xs text-ih-fg-3">
        {m.booking_privacy_shared_notice({ name: data.inspectorName })}
        {privacyUrl && <> {m.booking_privacy_see_our()} <a href={privacyUrl} target="_blank" rel="noreferrer" className="underline">{m.booking_link_privacy_policy()}</a>.</>}
      </p>
      {needsTurnstile && (
        <div className="mb-3 flex justify-center">
          <div ref={turnstileRef} />
        </div>
      )}

      {/* Why the form is not going through. `verifyUnavailable` announces
          itself without waiting for a click: a challenge that cannot load is
          not something the visitor can fix by trying harder. The copy names no
          direction — this sits BELOW the widget it refers to, and this form is
          rendered at whatever width the host site gives it. */}
      {(verifyError || verifyUnavailable) && (
        <p role="alert" className="mb-3 text-center text-[13px] font-semibold text-ih-bad-fg">
          {verifyError ?? m.booking_verify_unavailable()}
        </p>
      )}

      <button
        type="submit"
        // Only the in-flight guard: the challenge is reported after the click,
        // never pre-empted by a dead button.
        disabled={submitting}
        className="w-full px-4 py-3 bg-ih-primary text-ih-primary-fg rounded-lg font-bold text-sm hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
      >
        {submitting ? m.booking_submitting() : m.booking_embed_submit()}
      </button>

      {status && (
        <div
          className={`mt-3 text-[13px] ${
            status.ok ? "text-ih-ok-fg" : "text-ih-bad-fg"
          }`}
        >
          {status.text}
        </div>
      )}
    </form>
  );
}
