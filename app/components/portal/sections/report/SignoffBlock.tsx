import type { ReportSignoffView } from "./types";

const ROLE_LABEL: Record<ReportSignoffView["role"], string> = {
  field_observer: "Field Observer",
  pcr_reviewer: "PCR Reviewer",
};

/**
 * Commercial PCA Phase M — the Transmittal Letter signature block. Renders
 * one row per signoff (Field Observer / PCR Reviewer), each with name,
 * license, and signed date; flags a dual-role signer (same person holding
 * both roles) with an attestation note, per ASTM E2018 §11.4.3. Renders
 * nothing when there are no signoffs (light/residential reports).
 */
export function SignoffBlock({ signoffs }: { signoffs: ReportSignoffView[] }) {
  if (!signoffs.length) return null;
  return (
    <section data-pca-signoffs className="mb-5 print:break-inside-avoid">
      <h3 className="mb-1 text-sm font-semibold text-ih-fg-2">Signatures</h3>
      <ul className="space-y-2 text-sm text-ih-fg-1">
        {signoffs.map((s, i) => (
          <li key={`${s.role}-${i}`} className="border-l-2 border-ih-border pl-3">
            <span className="font-medium">{ROLE_LABEL[s.role]}:</span> {s.name}
            {s.license ? <span className="text-ih-fg-3"> — License {s.license}</span> : null}
            <span className="block text-ih-fg-3">
              Signed {new Date(s.signedAt).toLocaleDateString()}
              {s.qualificationsRef ? ` · ${s.qualificationsRef}` : ""}
            </span>
            {s.dualRole ? (
              <span className="block text-xs italic text-ih-fg-3">
                Dual-role attestation: this individual served in both signing capacities on this
                report, per ASTM E2018 §11.4.3.
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
