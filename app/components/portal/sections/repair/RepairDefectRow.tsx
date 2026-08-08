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
import { parseRepairActionTag, type RepairActionTag } from "~/lib/repair-action-tag";
import { Select } from "@core/shared-ui";
import { MoneyInput } from "~/components/MoneyInput";
import { RepairDefectRowView } from "./RepairDefectRowView";
import { m } from "~/paraglide/messages";

interface ItemDraft {
  requestedCreditCents: number | null;
  note: string;
  actionTag: RepairActionTag | null;
}

interface RepairDefectRowProps {
  defect: Defect;
  isSelected: boolean;
  draft: ItemDraft | undefined;
  creditCents: number | null;
  /**
   * #275 — the buyer's requested action, or null when they have not chosen one.
   *
   * REQUIRED, unlike `phrases`. The agent surface renders `RepairDefectRowView`
   * directly and never reaches this component's expanded region, so there is no
   * caller that legitimately omits the tag — and making it optional would let a
   * select render with no handler behind it. The agent side has no tag DATA
   * either (its rows come from report defects, not persisted items, with no join
   * key — see the plan's Task 3a), which is why nothing here tries to show one.
   */
  actionTag: RepairActionTag | null;
  /**
   * #275 — tenant-configured quick-insert phrases for the note field, already
   * resolved (see app/lib/repair-quick-phrases.ts). OPTIONAL because this row
   * is the one component both portals render and the agent surface has no note
   * field to serve — see app/components/agent/cross-portal-reuse.test.tsx.
   */
  phrases?: string[];
  onToggle: (defect: Defect) => void;
  onUpdateCredit: (defect: Defect, cents: number | null) => void;
  onUpdateNote: (defect: Defect, note: string) => void;
  onUpdateTag: (defect: Defect, tag: RepairActionTag | null) => void;
}

export function RepairDefectRow({
  defect,
  isSelected,
  draft,
  creditCents,
  actionTag,
  phrases,
  onToggle,
  onUpdateCredit,
  onUpdateNote,
  onUpdateTag,
}: RepairDefectRowProps) {
  // Append, never replace: the button is a convenience, and a convenience that
  // eats two typed sentences is worse than no button. Idempotent for the same
  // reason — a second click on the same phrase must be a no-op, not a repeat.
  const appendPhrase = (phrase: string) => {
    const current = (draft?.note ?? "").trim();
    if (current.includes(phrase)) return;
    onUpdateNote(defect, current ? `${current} ${phrase}` : phrase);
  };

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
        <RepairDefectRowView
          sectionTitle={defect.sectionTitle}
          itemLabel={defect.itemLabel}
          defectTitle={defect.defectTitle}
          location={defect.location}
          comment={defect.comment}
          category={defect.category}
        />
      </button>

      {/* Expanded action + credit + note */}
      {isSelected && (
        <div className="px-4 pb-4 pt-1 border-t border-ih-border space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                className="block text-[11px] font-bold text-ih-fg-4 uppercase tracking-widest mb-1"
                htmlFor={`action-${defect.findingKey}`}
              >
                {m.repair_defect_action_label()}
              </label>
              {/* The DS `Select`, not a bare `<select>` and not the
                  SegmentedControl the settings panels use.
                  - Not SegmentedControl: five choices do not fit this row's width
                    without wrapping, and this page is used on a phone at a
                    property.
                  - ⚠️ Not a bare `<select>`: the native chevron and option list
                    are UA-rendered, which is the one part design tokens do NOT
                    reach, so a correct-looking class list can still produce
                    unreadable options in dark mode. `Select` exists because that
                    was already solved once — it sets `appearance-none` and draws a
                    tokenized chevron over `.ih-input`.
                  `bare` because this row supplies its own micro-label, matching
                  the credit field beside it. The option words are the SAME ones
                  the shared list renders: an action that changes name between
                  being chosen and being read reads as two different things. */}
              <Select
                bare
                id={`action-${defect.findingKey}`}
                value={actionTag ?? ""}
                onChange={(e) => onUpdateTag(defect, parseRepairActionTag(e.target.value))}
                aria-label={m.repair_defect_action_aria({ label: defect.itemLabel })}
                // `.ih-input` is 36px; this row's controls are 32px. Matching the
                // neighbour beats matching the default when the two sit in one grid
                // cell pair — a half-step height difference reads as a mistake.
                className="!h-8 text-[13px]"
                options={[
                  // Untagged is an OPTION, not a blank. Having no preference is a
                  // different statement from not having reached the question.
                  { value: "", label: m.repair_defect_action_none() },
                  { value: "repair", label: m.repair_request_action_tag_repair() },
                  { value: "replace", label: m.repair_request_action_tag_replace() },
                  { value: "fund", label: m.repair_request_action_tag_fund() },
                  { value: "other", label: m.repair_request_action_tag_other() },
                ]}
              />
            </div>

            {/* #275 Q2b — the amount appears only when the buyer is asking for
                money. Asking for a repair and naming a figure are different
                requests, and offering both at once invited a credit on an item
                where nobody wanted one.

                ⚠️ The condition is plain `=== "fund"` and needs no compound
                fallback for older rows: the column migration backfilled every
                existing credit to `fund`, so no stored figure is hidden by this
                gate. That backfill is the reason this line is one comparison
                instead of two. */}
            {actionTag === "fund" && (
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
                {/* The credit is the client's own number and nothing else feeds
                    it. There used to be a "report estimate" hint here with a
                    one-click "Use estimate" button; both are gone. A figure the
                    platform or the inspector supplied becomes the client's ask the
                    instant they accept it, and then travels into a document
                    carrying the inspection company's name as though the company
                    had priced the repair. Telling a seeded number apart from one
                    the tenant typed would need provenance on the estimate, and
                    there is none — so neither is offered. */}
                <p className="mt-1 text-[11px] text-ih-fg-4">
                  {m.repair_defect_credit_hint()}
                </p>
              </div>
            )}
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
            {/* #275 — one-click fill for the adjacent field. Styled as inline
                text links rather than buttons so they read as secondary to the
                textarea. These insert the tenant's own wording into the client's
                note; they are the only quick-fill left on this row, and they put
                no money anywhere. */}
            {phrases && phrases.length > 0 && (
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                {phrases.map((phrase) => (
                  <button
                    key={phrase}
                    type="button"
                    onClick={() => appendPhrase(phrase)}
                    className="text-[11px] font-bold text-ih-primary hover:underline"
                  >
                    {phrase}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
