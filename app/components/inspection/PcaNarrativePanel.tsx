import { useState } from "react";
import type { PcaNarrativeData } from "~/components/portal/sections/report/types";
import { useGuardedSubmit } from "~/hooks/useGuardedSubmit";
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
 * One narrative block: its own textarea, its own guard, its own key.
 *
 * ⚠️ THE GUARD IS PER BLOCK, AND THAT IS THE WHOLE POINT (#106). This panel used
 * to hand every block's blur to ONE `narrativeFetcher` in inspection-edit.tsx.
 * `useGuardedSubmit` REFUSES a second submit while one is in flight, so a single
 * shared guard here would silently drop the second block's text whenever a
 * reader tabbed from one field to the next inside a round trip — the identical
 * failure the baseline calls out for `set-item-attribute`, where successive
 * writes for DIFFERENT fields are the expected gesture. One instance per block
 * gives each field its own in-flight window, which is the same shape
 * CompliancePanel's RelianceFieldRow already uses.
 */
function NarrativeBlock({
  fieldKey,
  label,
  initial,
}: {
  fieldKey: keyof PcaNarrativeData;
  label: string;
  initial: string;
}) {
  const { submit, busy } = useGuardedSubmit();
  const [value, setValue] = useState(initial);
  /** The last value actually sent — a blur with no edit must not write. */
  const [saved, setSaved] = useState(initial);

  function commit(next: string) {
    if (next === saved) return;
    // Remember it as saved only when the guard accepted the call; otherwise the
    // next blur would skip a value that was never sent.
    if (!submit({ intent: "save-pca-narrative", key: fieldKey, value: next }, { method: "POST" })) return;
    setSaved(next);
  }

  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ih-fg-3">
        {label} {busy ? <span className="text-ih-fg-3">{m.editor_pca_saving()}</span> : null}
      </span>
      <textarea
        className="w-full rounded border border-ih-border bg-ih-bg-card p-2 text-sm text-ih-fg-1 disabled:opacity-60"
        rows={3}
        value={value}
        disabled={busy}
        aria-busy={busy || undefined}
        onChange={(e) => setValue(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
      />
    </label>
  );
}

/**
 * Commercial PCA Phase S — narrative editor. One textarea per editable report
 * block (NO RTE per the project notes=textarea rule). Saves per-block on blur
 * through the route-action intent (BFF pattern — never a client-side fetch to
 * /api/...). Seeded blocks show their ASTM default copy until the inspector
 * edits them.
 */
export function PcaNarrativePanel({ narrative }: { narrative: PcaNarrativeData }) {
  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-ih-fg-2">{m.editor_pca_heading()}</h2>
      {blocks().map((b) => (
        <NarrativeBlock key={b.key} fieldKey={b.key} label={b.label} initial={narrative[b.key]} />
      ))}
    </div>
  );
}
