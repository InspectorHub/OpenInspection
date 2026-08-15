/**
 * <ReportSignatureBlock> — the "Inspected & Signed By" panel (or the DRAFT
 * notice when the report is unsigned/unpublished).
 *
 * Extracted from <ReportView>'s former inline IIFE. Behavior-preserving: the
 * markup is byte-identical and the variant decision still flows through the
 * pure `signatureBlockModel` helper.
 *
 * lint:ds — only `ih-*` design tokens; raw Tailwind colors are forbidden.
 */
import { signatureBlockModel, formatEpochMs } from "~/lib/report-helpers";
import { m } from "~/paraglide/messages";
import type { ReportSignature } from "./types";

export interface ReportSignatureBlockProps {
  isPublished: boolean;
  signature: ReportSignature | null;
  ownerPreview: boolean;
  /** Tenant timezone (IANA) that anchors report times. Defaults to UTC. */
  timeZone?: string;
  /** Report Style Presets (Spec B) — one small credential badge shown beside the
   *  signer info. Text credentials stay on the license line; at most one badge. */
  credentialBadgeUrl?: string | null;
}

export function ReportSignatureBlock({ isPublished, signature, ownerPreview, timeZone = "UTC", credentialBadgeUrl = null }: ReportSignatureBlockProps) {
  const sig = signatureBlockModel({ isPublished, signature, ownerPreview });
  if (sig.variant === "draft") {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 mt-8 mb-4">
        <div className="border border-ih-border rounded-xl p-6 bg-ih-bg-muted flex items-center gap-3">
          <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-md bg-ih-watch-bg text-ih-watch-fg">{m.pca_signature_draft_badge()}</span>
          <span className="text-sm text-ih-fg-3">{m.pca_signature_draft_note()}</span>
        </div>
      </div>
    );
  }
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 mt-8 mb-4">
      <div className="border border-ih-border rounded-xl p-6 bg-ih-bg-card">
        {/* The heading is part of the claim. "Inspected & Signed By" over a
            report nobody signed is the defect counsel ruled on, so the wording
            follows the state rather than sitting above it. */}
        <div className="text-[10px] font-bold uppercase tracking-widest text-ih-fg-3 mb-4">
          {sig.variant === "attribution" ? m.pca_signature_inspected_by() : m.pca_signature_signed_by()}
        </div>
        <div className="flex flex-col sm:flex-row items-start sm:items-end gap-4">
          {(sig.variant === "image" || sig.variant === "auto") && sig.signatureBase64 && (
            <img
              src={sig.signatureBase64}
              alt={m.pca_signature_img_alt()}
              className="h-16 object-contain border border-ih-border rounded bg-ih-bg-card p-1"
            />
          )}
          {/* Nothing is drawn where no signature exists. There was a variant
              here that set the inspector's NAME in the report's display font on
              a ruled line — the visual language of a handwritten signature, for
              a signature that did not exist. Counsel ruling 18a: never
              synthesize a signature from a person's name. */}
          <div className="text-sm text-ih-fg-2 space-y-0.5">
            <div className="font-semibold text-ih-fg-1">{sig.inspectorName}</div>
            {sig.license && (
              <div className="text-ih-fg-3 text-xs">{m.pca_signature_license({ license: sig.license })}</div>
            )}
            {credentialBadgeUrl && (
              <img src={credentialBadgeUrl} alt={m.pca_signature_credential_alt()} className="h-8 w-auto mt-1" />
            )}
            {sig.signedAt != null && (
              <div className="text-ih-fg-3 text-xs">{m.pca_signed_date({ date: formatEpochMs(sig.signedAt, timeZone) })}</div>
            )}
            {sig.signedAt != null && (
              <div className="text-[10px] text-ih-fg-3">{m.pca_signature_timezone_note({ tz: timeZone.replace(/_/g, " ") })}</div>
            )}
            {/* An automatically applied signature is a real signature with a
                different provenance, and the reader is entitled to the
                difference: the inspector authorised it in advance, they did not
                sign at publication. Phrased as the inspector's own standing
                authorisation — NOT as the platform signing on their behalf. */}
            {sig.variant === "auto" && (
              <div className="text-[10px] text-ih-fg-3">{m.pca_signature_auto_applied()}</div>
            )}
          </div>
        </div>
        {sig.showNudge && (
          <div className="print:hidden mt-4 text-xs text-ih-fg-3 border-t border-ih-border pt-3">
            {m.pca_signature_nudge_before()}<strong>{m.pca_signature_nudge_strong()}</strong>{m.pca_signature_nudge_after()}
          </div>
        )}
      </div>
    </div>
  );
}
