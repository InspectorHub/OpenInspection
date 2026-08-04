import { useEffect, useRef } from "react";
import {
  AGREEMENT_LANGUAGE_DISCLOSURE,
  DISCLOSURE_SANITIZER_PROFILE,
} from "../../../server/lib/legal/agreement-language-disclosure";

/**
 * The platform's language disclosure, rendered as a SIBLING of an agreement and
 * never inside one.
 *
 * `agreements.content` is tenant data — a contract between the tenant and their
 * client, which we are not a party to and write no word of. This block is the
 * platform speaking, so it has to be readable as the platform speaking. Three
 * things do that, in descending order of how much a reader relies on them:
 *
 *  1. It says so. `AGREEMENT_LANGUAGE_DISCLOSURE.label` is the heading, and it
 *     is the only part of this a hurried signer is guaranteed to take in.
 *  2. It sits outside the scroll region that holds the agreement text, in its
 *     own band with the muted surface used elsewhere for interface notes.
 *  3. `role="note"` (carried by the copy's own wrapper) says the same thing to
 *     assistive technology.
 *
 * Deliberately NOT `<SanitizedHtml>`: that component's allow-list is the tenant
 * rich-text one — the Quill toolbar — which permits neither `<section>` nor
 * `role`. Routing this through it would strip the wrapper and deliver a bare
 * paragraph, i.e. exactly the anonymous-clause reading the disclosure exists to
 * avoid. `DISCLOSURE_SANITIZER_PROFILE` is sized to this copy instead.
 *
 * The copy is a frozen module constant with no interpolation, so the DOMPurify
 * pass is defence in depth rather than a filter on untrusted input — the same
 * posture the agreement body gets, and cheap insurance against a future edit to
 * the constant. SSR emits the constant directly because Workers have no DOM.
 */
export function AgreementLanguageDisclosure({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const html = AGREEMENT_LANGUAGE_DISCLOSURE.html;

  useEffect(() => {
    let cancelled = false;
    void import("dompurify").then(({ default: DOMPurify }) => {
      if (cancelled || !ref.current) return;
      ref.current.innerHTML = DOMPurify.sanitize(html, {
        ALLOWED_TAGS: [...DISCLOSURE_SANITIZER_PROFILE.ALLOWED_TAGS],
        ALLOWED_ATTR: [...DISCLOSURE_SANITIZER_PROFILE.ALLOWED_ATTR],
      });
    });
    return () => {
      cancelled = true;
    };
  }, [html]);

  return (
    <div
      data-testid="agreement-language-disclosure"
      className={`bg-ih-bg-muted px-6 py-4 sm:px-10 ${className ?? ""}`}
    >
      {/* fg-2, not the fg-4 an eyebrow usually gets: this line is the disclosure's
          working part, and at 10px on the muted surface fg-4 measured 2.6:1 in
          dark mode — present, but not something a hurried signer reads. */}
      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-ih-fg-2">
        {AGREEMENT_LANGUAGE_DISCLOSURE.label}
      </p>
      <div
        ref={ref}
        // fg-2 rather than the fg-3 of the agreement text beside it: at 13px on the
        // muted surface fg-3 measured 4.34:1 in light mode, under AA for body size.
        // A note aimed at someone who reads English with difficulty is the last
        // place to spend contrast on looking discreet.
        className="mt-1.5 text-[13px] text-ih-fg-2 leading-relaxed"
        // Frozen platform copy; re-sanitized on mount with the disclosure profile.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
