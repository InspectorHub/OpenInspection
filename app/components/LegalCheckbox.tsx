/**
 * Reusable legal acceptance checkbox for account-creating public forms.
 * Renders only when at least one of termsUrl / privacyUrl is configured.
 */

import type { LegalLinks } from "~/lib/legal-links.server";
import { m } from "~/paraglide/messages";

export function LegalCheckbox({ legal }: { legal: LegalLinks }) {
  return (
    <label className="flex items-start gap-2 text-sm text-ih-fg-2 mt-5">
      <input type="checkbox" name="termsAccepted" required className="mt-0.5" />
      <span>
        {m.legal_checkbox_agree()}
        {legal.termsUrl && (
          <>{" "}<a href={legal.termsUrl} target="_blank" rel="noreferrer" className="font-semibold text-ih-primary hover:underline">{m.legal_checkbox_terms()}</a></>
        )}
        {legal.termsUrl && legal.privacyUrl && <> {m.legal_checkbox_and_ack()}</>}
        {legal.privacyUrl && (
          <>{" "}<a href={legal.privacyUrl} target="_blank" rel="noreferrer" className="font-semibold text-ih-primary hover:underline">{m.legal_checkbox_privacy()}</a></>
        )}
        .
      </span>
    </label>
  );
}
