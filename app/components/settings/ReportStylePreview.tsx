// Live, zero-round-trip preview of the resolved report appearance. Renders a
// trimmed mini-report (cover, section heading, band, one defect card, a typed
// signature) using the SAME var(--report-*) contract ReportView consumes, so the
// picker choice + brand colour reflect instantly. brandTokens (colour axis) and
// presetTokens (typography/layout axis) stay independent — §4.
import { brandTokens } from "~/lib/brand";
import { presetTokens } from "~/lib/report-style/preset-tokens";
import { BUILTIN_PROFILES_CLIENT } from "~/lib/report-style/profiles-client";

export function ReportStylePreview({
  profileId,
  primaryColor,
}: {
  profileId: string;
  primaryColor: string | null;
}) {
  const tokens = BUILTIN_PROFILES_CLIENT[profileId]?.tokens ?? {};
  const headingStyle = {
    fontFamily: "var(--report-heading-font)",
    fontWeight: "var(--report-heading-weight)" as unknown as number,
    letterSpacing: "var(--report-heading-spacing)",
    textTransform: "var(--report-heading-transform)" as unknown as "none",
  };
  return (
    <div
      aria-hidden
      className="overflow-hidden select-none"
      style={{
        ...brandTokens(primaryColor),
        ...presetTokens(tokens),
        background: "var(--report-paper)",
        color: "var(--report-ink)",
        border: "var(--report-frame)",
        borderRadius: "var(--report-radius)",
        boxShadow: "0 1px 2px rgba(0,0,0,0.06), 0 8px 24px rgba(0,0,0,0.06)",
      }}
    >
      {/* cover */}
      <div style={{ position: "relative", height: "var(--report-cover-height)", background: "linear-gradient(150deg,#c3ccd2,#9aa7af)" }}>
        <div style={{ position: "absolute", inset: 0, background: "var(--report-cover-overlay)" }} />
        <div style={{ position: "absolute", left: 14, bottom: 10, color: "var(--report-cover-ink)" }}>
          <div style={{ ...headingStyle, fontSize: 17, lineHeight: 1.1 }}>1428 Maple Grove Dr</div>
          <div style={{ fontSize: 11, opacity: 0.85 }}>Jul 19, 2026 · Marcus Reed</div>
        </div>
      </div>
      {/* body */}
      <div style={{ padding: "14px 16px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h4 style={{ ...headingStyle, fontSize: 16, margin: 0 }}>
            <span style={{ color: "var(--report-muted)", marginRight: 4 }}>1 -</span>Exterior
          </h4>
          <div style={{ flex: 1, height: 1, background: "var(--report-band)" }} />
          <span style={{ fontSize: 11, color: "var(--report-muted)" }}>2 items</span>
        </div>
        <div
          style={{
            marginTop: 12,
            padding: "10px 12px",
            fontSize: 13,
            background: "var(--report-card-fill)",
            borderRadius: "var(--report-radius)",
            borderLeft: "4px solid #c0392b",
            boxShadow: "0 0 0 1px var(--report-hair)",
          }}
        >
          <div style={{ fontWeight: 600 }}>Roof — missing shingles</div>
          <div style={{ color: "var(--report-muted)", fontSize: 12, marginTop: 2 }}>Several shingles missing on the SE slope.</div>
        </div>
        <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end" }}>
          <span style={{ ...headingStyle, fontStyle: "italic", fontSize: 20, borderBottom: "1px solid var(--report-hair)", paddingBottom: 2 }}>Marcus Reed</span>
        </div>
      </div>
    </div>
  );
}
