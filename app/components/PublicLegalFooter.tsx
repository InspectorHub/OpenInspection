import { m } from "~/paraglide/messages";

/** Compact Privacy · Terms footer for public tenant surfaces. */
export function PublicLegalFooter({
  privacyUrl,
  termsUrl,
  className = "",
}: {
  privacyUrl?: string | null;
  termsUrl?: string | null;
  className?: string;
}) {
  if (!privacyUrl && !termsUrl) return null;
  return (
    <footer
      className={`mt-10 pt-6 border-t border-ih-border text-center text-[11px] text-ih-fg-3 ${className}`}
    >
      {privacyUrl && (
        <a href={privacyUrl} target="_blank" rel="noreferrer" className="hover:underline hover:text-ih-fg-3">
          {m.booking_link_privacy_policy()}
        </a>
      )}
      {privacyUrl && termsUrl && <span className="mx-2">·</span>}
      {termsUrl && (
        <a href={termsUrl} target="_blank" rel="noreferrer" className="hover:underline hover:text-ih-fg-3">
          {m.legal_checkbox_terms()}
        </a>
      )}
    </footer>
  );
}
