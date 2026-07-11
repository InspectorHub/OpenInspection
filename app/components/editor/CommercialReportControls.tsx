interface CommercialSubtypeOption {
 id: string;
 label: string;
}

/**
 * Commercial PCA Phase T — app-safe mirror of PLATFORM_SUBTYPES
 * (server/lib/commercial-subtypes.ts). The server presets/resolvers built on
 * PLATFORM_SUBTYPES stay server-only (they're not meant to reach the client
 * bundle); this is just the {id,label} pairs the editor needs to render the
 * subtype selector. Keep in sync with PLATFORM_SUBTYPES if a platform
 * subtype is ever added/renamed.
 */
const APP_COMMERCIAL_SUBTYPES: readonly CommercialSubtypeOption[] = [
 { id: "office", label: "Office" },
 { id: "retail", label: "Retail" },
 { id: "hospitality", label: "Hospitality" },
 { id: "industrial", label: "Industrial" },
 { id: "institutional", label: "Institutional" },
 { id: "mixed-use", label: "Mixed-use" },
] as const;

export type ReportTier = "light_commercial" | "full_pca";

const TIERS: { value: ReportTier; label: string }[] = [
 { value: "light_commercial", label: "Light Commercial" },
 { value: "full_pca", label: "Full PCA" },
];

interface CommercialReportControlsProps {
 commercialSubtype: string | null;
 reportTier: ReportTier | null;
 onChangeSubtype: (subtype: string | null) => void;
 onChangeTier: (tier: ReportTier) => void;
 saving?: boolean;
}

/**
 * Commercial PCA Phase T — commercial-only property panel block: the
 * subtype selector (Piece B — feeds getMetadataPreset('commercial', subtype)
 * so the Building Profile lights up) and the report tier selector (Piece C
 * — "auto light, user elevates" per report-tier.ts). Both persist through
 * the same property-facts save path (see savePropertyFacts in
 * inspection-edit.tsx), not local-only state.
 */
export function CommercialReportControls({
 commercialSubtype,
 reportTier,
 onChangeSubtype,
 onChangeTier,
 saving,
}: CommercialReportControlsProps) {
 // Mirrors resolveReportTier's default (server/lib/report-tier.ts): unset/
 // null -> light_commercial. Kept as a tiny inline rule rather than
 // importing the server-only resolver just for a UI default.
 const activeTier = reportTier === "full_pca" ? "full_pca" : "light_commercial";

 return (
 <div className="space-y-5" data-testid="commercial-report-controls">
 <div>
 <label className="block text-[12px] font-bold text-ih-fg-3 mb-1.5">
 Commercial subtype{" "}
 {saving ? <span className="text-ih-fg-4 font-normal normal-case">(saving…)</span> : null}
 </label>
 <select
 data-testid="commercial-subtype-select"
 value={commercialSubtype ?? ""}
 onChange={(e) => onChangeSubtype(e.target.value || null)}
 className="ih-input w-full max-w-sm"
 >
 <option value="">Select subtype…</option>
 {APP_COMMERCIAL_SUBTYPES.map((s) => (
 <option key={s.id} value={s.id}>{s.label}</option>
 ))}
 </select>
 </div>

 <div>
 <label className="block text-[12px] font-bold text-ih-fg-3 mb-1.5">Report tier</label>
 <div className="flex gap-2 max-w-sm">
 {TIERS.map((t) => (
 <button
 key={t.value}
 type="button"
 data-testid={`report-tier-${t.value}`}
 onClick={() => onChangeTier(t.value)}
 aria-pressed={activeTier === t.value}
 className={`flex-1 py-2 rounded-md text-[12px] font-bold border transition-colors ${
 activeTier === t.value
 ? "border-ih-primary bg-ih-primary-tint text-ih-primary"
 : "border-ih-border text-ih-fg-3"
 }`}
 >
 {t.label}
 </button>
 ))}
 </div>
 <p className="mt-1.5 text-[11px] text-ih-fg-4">
 Full PCA adds the ASTM E2018 transmittal, two cost tables, reviewer sign-off and photo appendix.
 </p>
 </div>
 </div>
 );
}
