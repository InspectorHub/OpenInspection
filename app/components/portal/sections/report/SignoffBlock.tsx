import type { ReportSignoffView } from "./types";
import { formatEpochMs } from "~/lib/report-helpers";
import { m } from "~/paraglide/messages";

/**
 * Commercial PCA Phase M — the Transmittal Letter signature block. Renders
 * one row per signoff (Field Observer / PCR Reviewer), each with name,
 * license, and signed date; flags a dual-role signer (same person holding
 * both roles) with an attestation note, per ASTM E2018 §11.4.3. Renders
 * nothing when there are no signoffs (light/residential reports).
 */
export function SignoffBlock({ signoffs, timeZone = "UTC" }: { signoffs: ReportSignoffView[]; timeZone?: string }) {
  if (!signoffs.length) return null;
  const ROLE_LABEL: Record<ReportSignoffView["role"], string> = {
    field_observer: m.pca_signoff_role_field_observer(),
    pcr_reviewer: m.pca_signoff_role_pcr_reviewer(),
  };
  return (
    <section data-pca-signoffs className="mb-5 print:break-inside-avoid">
      <h3 className="mb-1 text-sm font-semibold text-ih-fg-2">{m.pca_signoff_title()}</h3>
      <ul className="space-y-2 text-sm text-ih-fg-1">
        {signoffs.map((s, i) => (
          <li key={`${s.role}-${i}`} className="border-l-2 border-ih-border pl-3">
            <span className="font-medium">{ROLE_LABEL[s.role]}:</span> {s.name}
            {s.license ? <span className="text-ih-fg-3"> — {m.pca_signoff_license({ license: s.license })}</span> : null}
            <span className="block text-ih-fg-3">
              {m.pca_signed_date({ date: formatEpochMs(s.signedAt, timeZone) })}
              {s.qualificationsRef ? ` · ${s.qualificationsRef}` : ""}
            </span>
            {s.dualRole ? (
              <span className="block text-xs italic text-ih-fg-3">
                {m.pca_signoff_dual_role()}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
