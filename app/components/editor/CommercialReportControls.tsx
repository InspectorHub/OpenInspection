import { SegmentedControl } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

interface CommercialSubtypeOption {
 id: string;
 label: string;
}

export type ReportTier = "light_commercial" | "full_pca";

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

 // App-safe mirror of PLATFORM_SUBTYPES (server/lib/commercial-subtypes.ts).
 // The server presets/resolvers built on PLATFORM_SUBTYPES stay server-only
 // (they're not meant to reach the client bundle); this is just the {id,label}
 // pairs the editor needs to render the subtype selector. Keep in sync with
 // PLATFORM_SUBTYPES if a platform subtype is ever added/renamed. Built in
 // render so the message functions resolve per-render (never frozen at import).
 const APP_COMMERCIAL_SUBTYPES: readonly CommercialSubtypeOption[] = [
  { id: "office", label: m.editor_commercial_subtype_office() },
  { id: "retail", label: m.editor_commercial_subtype_retail() },
  { id: "hospitality", label: m.editor_commercial_subtype_hospitality() },
  { id: "industrial", label: m.editor_commercial_subtype_industrial() },
  { id: "institutional", label: m.editor_commercial_subtype_institutional() },
  { id: "mixed-use", label: m.editor_commercial_subtype_mixed_use() },
 ];

 const TIERS: { value: ReportTier; label: string }[] = [
  { value: "light_commercial", label: m.editor_commercial_tier_light() },
  { value: "full_pca", label: m.editor_commercial_tier_full() },
 ];

 return (
 <div className="space-y-5" data-testid="commercial-report-controls">
 <div>
 <label className="block text-[12px] font-bold text-ih-fg-3 mb-1.5">
 {m.editor_commercial_subtype_label()}{" "}
 {saving ? <span className="text-ih-fg-4 font-normal normal-case">{m.editor_commercial_saving()}</span> : null}
 </label>
 <select
 data-testid="commercial-subtype-select"
 value={commercialSubtype ?? ""}
 onChange={(e) => onChangeSubtype(e.target.value || null)}
 className="ih-input w-full max-w-sm"
 >
 <option value="">{m.editor_commercial_subtype_placeholder()}</option>
 {APP_COMMERCIAL_SUBTYPES.map((s) => (
 <option key={s.id} value={s.id}>{s.label}</option>
 ))}
 </select>
 </div>

 <div>
 <label className="block text-[12px] font-bold text-ih-fg-3 mb-1.5">{m.editor_commercial_tier_label()}</label>
 <SegmentedControl
 ariaLabel={m.editor_commercial_tier_label()}
 value={activeTier}
 onChange={(v) => onChangeTier(v as ReportTier)}
 options={TIERS.map((t) => ({ value: t.value, label: t.label }))}
 className="max-w-sm"
 />
 <p className="mt-1.5 text-[11px] text-ih-fg-4">
 {m.editor_commercial_pca_description()}
 </p>
 </div>
 </div>
 );
}
