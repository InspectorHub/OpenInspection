import type { ReactNode } from "react";
import { brandTokens, type TenantBrand } from "~/lib/brand";
import { PublicLegalFooter } from "~/components/PublicLegalFooter";
import type { CompanyProfile } from "./booking-constants";
import { m } from "~/paraglide/messages";

export function BookingErrorState({ error }: { error: string | null }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-ih-bg-app">
      <div className="text-center p-8">
        <h1 className="text-2xl font-bold text-ih-fg-1">{m.booking_error_state_heading()}</h1>
        <p className="text-ih-fg-3 mt-2">
          {error ?? m.booking_error_state_default()}
        </p>
      </div>
    </div>
  );
}

// B-16 — the company hasn't configured working hours yet: show an honest
// not-open state instead of a wizard whose submit can only fail.
export function BookingNotOpenState({
  profile,
  brand,
  privacyUrl,
  termsUrl,
}: {
  profile: CompanyProfile;
  brand: TenantBrand;
  privacyUrl?: string | null;
  termsUrl?: string | null;
}) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-ih-bg-app px-4" style={brandTokens(brand.primaryColor)}>
      <div className="max-w-md w-full text-center p-8 bg-ih-bg-card border border-ih-border rounded-xl">
        <h1 className="text-xl font-bold text-ih-fg-1">{m.booking_not_open_heading()}</h1>
        <p className="text-[14px] text-ih-fg-3 mt-3 leading-relaxed">
          {m.booking_not_open_body({ company: profile.company })}
        </p>
      </div>
      <PublicLegalFooter
        privacyUrl={privacyUrl ?? brand.privacyUrl}
        termsUrl={termsUrl ?? brand.termsUrl}
        className="mt-6 pt-0 border-t-0"
      />
    </div>
  );
}

export function BookingShell({
  profile,
  brand,
  privacyUrl,
  termsUrl = null,
  children,
}: {
  profile: CompanyProfile;
  brand: TenantBrand;
  privacyUrl: string | null;
  termsUrl?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-ih-bg-app py-12 px-4" style={brandTokens(brand.primaryColor)}>
      <div className="max-w-2xl mx-auto">
        {/* Company header */}
        <nav className="mb-8 flex items-center gap-3">
          {brand.logoUrl ? (
            <img src={brand.logoUrl} alt={brand.companyName ?? profile.company ?? m.booking_logo_alt()} className="h-10 w-auto" />
          ) : (
            <div className="w-10 h-10 rounded-full bg-ih-primary-tint flex items-center justify-center text-ih-primary text-lg font-bold">
              {profile.company.charAt(0)}
            </div>
          )}
          <div>
            <p className="text-[15px] font-semibold text-ih-fg-1">{profile.company}</p>
          </div>
        </nav>

        {children}

        <p className="text-center text-[11px] text-ih-fg-3 mt-6">
          {m.booking_powered_by()}
        </p>
        {(privacyUrl || termsUrl) && (
          <p className="mt-8 text-center text-xs text-ih-fg-3">
            {privacyUrl && (
              <a href={privacyUrl} target="_blank" rel="noreferrer" className="hover:underline">{m.booking_link_privacy_policy()}</a>
            )}
            {privacyUrl && termsUrl && <span className="mx-1.5">·</span>}
            {termsUrl && (
              <a href={termsUrl} target="_blank" rel="noreferrer" className="hover:underline">{m.legal_checkbox_terms()}</a>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
