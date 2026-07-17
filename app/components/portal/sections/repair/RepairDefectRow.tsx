/**
 * <RepairDefectRow> — a single per-defect row in the Repair Request Builder.
 *
 * Presentational: receives the defect, its selection/draft state, and the three
 * mutation callbacks from the parent <RepairBuilderSection>. Holds no fetcher or
 * offline-queue logic — those stay in the parent.
 *
 * lint:ds — only `ih-*` design tokens; raw Tailwind colors are forbidden.
 */
import type { Defect } from "../RepairBuilderSection";
import { MoneyInput } from "~/components/MoneyInput";
import { m } from "~/paraglide/messages";

interface ItemDraft {
  requestedCreditCents: number | null;
  note: string;
}

function categoryLabel(cat: Defect["category"]): string {
  return cat === "safety" ? "Safety" : cat === "recommendation" ? "Recommendation" : "Maintenance";
}

function categoryClass(cat: Defect["category"]): string {
  if (cat === "safety") return "bg-ih-bad-bg text-ih-bad-fg";
  if (cat === "recommendation") return "bg-ih-info-bg text-ih-info-fg";
  return "bg-ih-bg-muted text-ih-fg-3";
}

interface RepairDefectRowProps {
  defect: Defect;
  isSelected: boolean;
  draft: ItemDraft | undefined;
  creditCents: number | null;
  onToggle: (defect: Defect) => void;
  onUpdateCredit: (defect: Defect, cents: number | null) => void;
  onUpdateNote: (defect: Defect, note: string) => void;
}

export function RepairDefectRow({
  defect,
  isSelected,
  draft,
  creditCents,
  onToggle,
  onUpdateCredit,
  onUpdateNote,
}: RepairDefectRowProps) {
  return (
    <div
      className={`bg-ih-bg-card border rounded-xl transition-colors ${
        isSelected ? "border-ih-primary/60" : "border-ih-border"
      }`}
    >
      {/* Row header */}
      <button
        type="button"
        className="w-full flex items-start gap-3 px-4 py-3 text-left"
        onClick={() => onToggle(defect)}
      >
        <span
          className={`mt-0.5 w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
            isSelected
              ? "bg-ih-primary border-ih-primary"
              : "border-ih-border-strong bg-ih-bg-app"
          }`}
        >
          {isSelected && (
            <svg viewBox="0 0 12 10" className="w-3 h-2 fill-white">
              <path d="M1 5l3.5 3.5L11 1" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[13px] font-semibold text-ih-fg-1">
            {defect.itemLabel}
          </span>
          <span className="block text-[12px] text-ih-fg-3 mt-0.5">
            {defect.sectionTitle}
          </span>
          {defect.comment && (
            <span className="block text-[12px] text-ih-fg-4 mt-0.5 line-clamp-2">
              {defect.comment}
            </span>
          )}
        </span>
        <span
          className={`inline-flex items-center h-5 px-2 rounded text-[10px] font-bold uppercase tracking-wider shrink-0 ml-2 ${categoryClass(defect.category)}`}
        >
          {categoryLabel(defect.category)}
        </span>
      </button>

      {/* Expanded credit + note */}
      {isSelected && (
        <div className="px-4 pb-4 pt-1 border-t border-ih-border space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-ih-fg-4 uppercase tracking-widest mb-1">
                {m.repair_defect_credit_label()}
              </label>
              <MoneyInput
                cents={creditCents}
                onChange={(c) => onUpdateCredit(defect, c)}
                ariaLabel={m.repair_defect_credit_aria({ label: defect.itemLabel })}
                className="w-full h-8 px-3 rounded-md border border-ih-border bg-ih-bg-app text-[13px] text-ih-fg-1 placeholder:text-ih-fg-4 focus:outline-none focus:border-ih-primary"
              />
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-bold text-ih-fg-4 uppercase tracking-widest mb-1">
              {m.repair_defect_note_label()}
            </label>
            <textarea
              placeholder={m.repair_defect_note_placeholder()}
              rows={2}
              value={draft?.note ?? ""}
              onChange={(e) => onUpdateNote(defect, e.target.value)}
              className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-app text-[13px] text-ih-fg-1 placeholder:text-ih-fg-4 resize-none focus:outline-none focus:border-ih-primary"
            />
          </div>
        </div>
      )}
    </div>
  );
}
