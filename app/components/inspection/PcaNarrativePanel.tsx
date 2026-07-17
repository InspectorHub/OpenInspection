import { useState } from "react";
import type { PcaNarrativeData } from "~/components/portal/sections/report/types";
import { m } from "~/paraglide/messages";

// Thunk (not a module const) so each label resolves at render time — a
// module-level const would freeze the message at import.
function blocks(): { key: keyof PcaNarrativeData; label: string }[] {
  return [
    { key: "transmittalLetter", label: m.editor_pca_block_transmittal() },
    { key: "summaryGeneralDescription", label: m.editor_pca_block_general_description() },
    { key: "summaryPhysicalCondition", label: m.editor_pca_block_physical_condition() },
    { key: "summaryRecommendations", label: m.editor_pca_block_recommendations() },
    { key: "purpose", label: m.editor_pca_block_purpose() },
    { key: "scopeOfWork", label: m.editor_pca_block_scope() },
    { key: "limitationsExceptions", label: m.editor_pca_block_limitations() },
    { key: "reconnaissance", label: m.editor_pca_block_reconnaissance() },
    { key: "additionalConsiderations", label: m.editor_pca_block_additional() },
  ];
}

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
        {m.editor_pca_heading()} {saving ? <span className="text-ih-fg-3">{m.editor_pca_saving()}</span> : null}
      </h2>
      {blocks().map((b) => (
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
