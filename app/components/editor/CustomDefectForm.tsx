import { Button } from "@core/shared-ui";
import { BUILT_IN_DEFECT_CATEGORIES, type CustomDefectCategory } from "../../lib/custom-defects";
import { DEFECT_TRADE_OPTIONS, type DefectTrade } from "../../lib/defect-fields";
import { m } from "~/paraglide/messages";

export interface CustomDefectFormProps {
  title: string;
  comment: string;
  category: CustomDefectCategory;
  /** IA-85 — the trade, from the same vocabulary the canned defect row offers
   *  (`DefectFieldsRow`). `''` is "not picked": trade is optional here because
   *  the publish gate does not read custom defects. */
  trade: DefectTrade | "";
  saveToLibrary: boolean;
  /** When set, renders the "Save to my library" checkbox (Track H B-20 back-flow). */
  showSaveToLibrary: boolean;
  /** IA-59 — the tenant's configured defect categories, offered alongside the
   *  three built-in seeds so field-added defects can use a custom category. */
  categories?: Array<{ id: string; name: string }>;
  onTitleChange: (value: string) => void;
  onCommentChange: (value: string) => void;
  onCategoryChange: (value: CustomDefectCategory) => void;
  onTradeChange: (value: DefectTrade | "") => void;
  onSaveToLibraryChange: (value: boolean) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

/* B-20 — inline add form for a field-authored custom defect. */
export function CustomDefectForm({
  title,
  comment,
  category,
  trade,
  saveToLibrary,
  showSaveToLibrary,
  categories,
  onTitleChange,
  onCommentChange,
  onCategoryChange,
  onTradeChange,
  onSaveToLibraryChange,
  onCancel,
  onSubmit,
}: CustomDefectFormProps) {
  return (
    <div className="p-2.5 rounded-lg border border-dashed border-ih-border-strong space-y-2">
      <input
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        placeholder={m.editor_customdefect_title_placeholder()}
        aria-label={m.editor_customdefect_title_aria()}
        autoFocus
        className="w-full h-9 px-3 rounded-lg border border-ih-border bg-ih-bg-card text-[13px] focus:shadow-ih-focus focus:border-ih-primary outline-none"
      />
      <textarea
        value={comment}
        onChange={(e) => onCommentChange(e.target.value)}
        placeholder={m.editor_customdefect_narrative_placeholder()}
        aria-label={m.editor_customdefect_narrative_aria()}
        className="w-full h-16 px-3 py-2 rounded-lg border border-ih-border bg-ih-bg-card text-[13px] resize-none focus:shadow-ih-focus focus:border-ih-primary outline-none"
      />
      <div className="flex items-center flex-wrap gap-2">
        <select
          value={category}
          onChange={(e) => onCategoryChange(e.target.value as CustomDefectCategory)}
          aria-label={m.editor_customdefect_category_aria()}
          className="h-8 px-2 rounded-lg border border-ih-border bg-ih-bg-card text-[12px] outline-none"
        >
          <option value="safety">{m.editor_customdefect_category_safety()}</option>
          <option value="recommendation">{m.editor_customdefect_category_recommendation()}</option>
          <option value="maintenance">{m.editor_customdefect_category_maintenance()}</option>
          {/* IA-59 — tenant's configured categories, minus the three built-ins
              (matched by name, case-insensitive) so nothing shows up twice. */}
          {(categories ?? [])
            .filter((c) => !BUILT_IN_DEFECT_CATEGORIES.includes(c.name.trim().toLowerCase() as (typeof BUILT_IN_DEFECT_CATEGORIES)[number]))
            .map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
        </select>
        {/* IA-85 — same vocabulary and same control as the canned defect row
            (DefectFieldsRow), so one list of defects reads as one list.
            The PLACEHOLDER differs on purpose: the canned row prints a visible
            `TRADE` label above its select and can say "— select —", while this
            compact form has no label rail, so a bare "— select —" would sit
            beside a self-describing category box saying nothing about itself. */}
        <select
          value={trade}
          onChange={(e) => onTradeChange(e.target.value as DefectTrade | "")}
          aria-label={m.editor_defect_trade_label()}
          className="h-8 px-2 rounded-lg border border-ih-border bg-ih-bg-card text-[12px] outline-none"
        >
          <option value="">{m.editor_customdefect_trade_placeholder()}</option>
          {DEFECT_TRADE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {/* Track H (B-20 back-flow) — default OFF so one-off findings don't pollute the library */}
        {showSaveToLibrary && (
          <label className="flex items-center gap-1.5 text-[11px] text-ih-fg-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={saveToLibrary}
              onChange={(e) => onSaveToLibraryChange(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-ih-border-strong text-ih-primary focus:ring-ih-primary/30"
            />
            {m.editor_customdefect_save_to_library()}
          </label>
        )}
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
        >
          {m.common_cancel()}
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={onSubmit}
          disabled={!title.trim()}
        >
          {m.editor_customdefect_add()}
        </Button>
      </div>
    </div>
  );
}
