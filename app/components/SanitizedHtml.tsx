import { useEffect, useRef } from "react";

/**
 * Renders agreement rich-text HTML with a client-side DOMPurify pass as
 * defense-in-depth on top of the server-side `sanitizeAgreementHtml()` that
 * already runs at write time.
 *
 * DOMPurify needs a DOM, which Cloudflare Workers SSR does not have, so it is
 * imported and applied only in the browser (and in the Browser Run headless
 * renderer used to produce signed PDFs). SSR emits the already server-sanitized
 * `html` so the first paint — and any no-JS PDF fallback — stays safe; the
 * effect then re-sanitizes with a real HTML parser once mounted.
 *
 * The allow-list mirrors the Quill editor toolbar and the server sanitizer:
 * basic formatting, two heading levels, lists, and `class` (for `ql-indent-N`).
 */
const ALLOWED_TAGS = ["p", "strong", "em", "u", "b", "i", "h2", "h3", "ol", "ul", "li", "br", "span"];
const ALLOWED_ATTR = ["class"];

export function SanitizedHtml({ html, className }: { html: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void import("dompurify").then(({ default: DOMPurify }) => {
      if (cancelled || !ref.current) return;
      ref.current.innerHTML = DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR });
    });
    return () => {
      cancelled = true;
    };
  }, [html]);

  return (
    <div
      ref={ref}
      className={className}
      // Server-sanitized at write time (sanitizeAgreementHtml); DOMPurify re-sanitizes on mount.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
