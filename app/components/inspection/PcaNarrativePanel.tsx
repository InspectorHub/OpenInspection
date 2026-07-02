import { useState } from "react";
import type { PcaNarrativeData } from "~/components/portal/sections/report/types";

const BLOCKS: { key: keyof PcaNarrativeData; label: string }[] = [
  { key: "transmittalLetter", label: "Transmittal Letter" },
  { key: "summaryGeneralDescription", label: "1.1 General Description" },
  { key: "summaryPhysicalCondition", label: "1.2 General Physical Condition" },
  { key: "summaryRecommendations", label: "1.5 Recommendations" },
  { key: "purpose", label: "2.1 Purpose" },
  { key: "scopeOfWork", label: "2.2 Scope of Work (methodology folds in here)" },
  { key: "limitationsExceptions", label: "2.3 Limitations & Exceptions" },
  { key: "reconnaissance", label: "2.4 General Property Reconnaissance" },
  { key: "additionalConsiderations", label: "Additional Considerations" },
];

/**
 * Commercial PCA Phase S — narrative editor. One textarea per editable report
 * block (NO RTE per the project notes=textarea rule). Saves per-block on blur
 * via the parent's onSave, which the caller wires to a route-action intent
 * dispatch (BFF pattern — never a client-side fetch to /api/...). Seeded
 * blocks show their ASTM default copy until the inspector edits them.
 */
export function PcaNarrativePanel({
  narrative,
  onSave,
  saving,
}: {
  narrative: PcaNarrativeData;
  onSave: (key: keyof PcaNarrativeData, value: string) => void;
  saving: boolean;
}) {
  const [draft, setDraft] = useState<PcaNarrativeData>(narrative);
  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-ih-fg-2">
        Report Narrative {saving ? <span className="text-ih-fg-3">(saving…)</span> : null}
      </h2>
      {BLOCKS.map((b) => (
        <label key={b.key} className="block">
          <span className="mb-1 block text-xs font-medium text-ih-fg-3">{b.label}</span>
          <textarea
            className="w-full rounded border border-ih-border bg-ih-bg-card p-2 text-sm text-ih-fg-1"
            rows={3}
            value={draft[b.key]}
            onChange={(e) => setDraft((d) => ({ ...d, [b.key]: e.target.value }))}
            onBlur={(e) => onSave(b.key, e.target.value)}
          />
        </label>
      ))}
    </div>
  );
}
