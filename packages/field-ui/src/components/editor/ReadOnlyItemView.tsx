import { useFieldDataSource } from "../../context";
import { m } from "../../i18n";
import { renderTemplate } from "../../shared/mustache";
import { DEFECT_TRADE_LABELS, DEFECT_DEADLINE_LABELS, DEFECT_TIMEFRAME_LABELS } from "../../shared/defect-fields";
import { findRatingLevel, type EditorRatingLevel } from "../../shared/rating-levels";
import { ItemPhotoStrip, type StripPhoto } from "../media-studio/ItemPhotoStrip";
import { ItemHeading } from "./ItemHeading";

type Entry = { id: string; title?: string; comment?: string; default?: boolean; location?: string };
type StateRow = { cannedId: string; included?: boolean; comment?: string; location?: string | null; trade?: string | null; deadline?: string | null; timeframe?: string | null };
type Line = { id: string; title: string; body: string };

interface ReadOnlyItemViewProps {
  item: { id: string; label?: string; name?: string; type?: string; description?: string; tabs?: unknown } | null | undefined;
  sectionTitle: string | undefined;
  result: Record<string, unknown>;
  ratingLevels: EditorRatingLevel[];
  inspectionId: string;
  coverKey: string | null;
  onOpenPhoto?: (itemId: string, index: number) => void;
  videoPosterUrl?: (streamUid: string, posterPct?: number) => string | null;
  pendingPhotoUrl?: (pendingId: string) => string | undefined;
}

const SECTION = "text-[10px] font-bold uppercase tracking-[0.1em] text-ih-fg-3";

const TAB_LABELS = { information: () => m.editor_item_tab_information(), limitations: () => m.editor_item_tab_limitations(), defects: () => m.editor_item_tab_defects() } as const;

/** The item attributes (brand, year, ...) as the Mustache values the comment prose reads. */
function attributeVars(attrs: unknown): Record<string, string | null> {
  const vars: Record<string, string | null> = {};
  if (!attrs || typeof attrs !== "object") return vars;
  for (const [k, v] of Object.entries(attrs as Record<string, unknown>)) {
    if (typeof v === "string") vars[k] = v.length > 0 ? v : null;
    else if (typeof v === "number" && Number.isFinite(v)) vars[k] = String(v);
    else if (typeof v === "boolean") vars[k] = v ? "yes" : "no";
    else vars[k] = null;
  }
  return vars;
}

/**
 * The comments that are in the report for this item, per tab: a template entry counts when the inspector switched it
 * on, or when nobody touched it and the template has it on by default (the editor's own rule), plus the custom defects.
 * Each prints its title and its prose, with the item's attributes and the defect fields filled in as the editor does.
 */
function includedByTab(item: NonNullable<ReadOnlyItemViewProps["item"]>, result: Record<string, unknown>) {
  const tabs = (item.tabs ?? {}) as Record<string, Entry[] | undefined>;
  const state = (result.tabs ?? {}) as Record<string, StateRow[] | undefined>;
  const attrs = attributeVars(result.attributes);
  const groups: Array<{ tab: keyof typeof TAB_LABELS; lines: Line[] }> = [];
  for (const tab of Object.keys(TAB_LABELS) as Array<keyof typeof TAB_LABELS>) {
    const rows = new Map((state[tab] ?? []).map((r) => [r.cannedId, r] as const));
    const lines: Line[] = [];
    for (const e of tabs[tab] ?? []) {
      const row = rows.get(e.id);
      if (!(row && row.included !== undefined ? row.included : e.default)) continue;
      // The text is the inspector's own wording when there is one, else the template's (as the report). Only a defect's
      // prose is filled in (location, trade, deadline, timeframe, then the item's attributes), in the editor and the report alike.
      const text = row && typeof row.comment === "string" && row.comment.length > 0 ? row.comment : e.comment ?? "";
      const vars: Record<string, string | null> | null = tab === "defects"
        ? {
            location: row?.location ? row.location : e.location || null,
            trade: row?.trade ? DEFECT_TRADE_LABELS[row.trade as keyof typeof DEFECT_TRADE_LABELS] : null,
            deadline: row?.deadline ? DEFECT_DEADLINE_LABELS[row.deadline as keyof typeof DEFECT_DEADLINE_LABELS] : null,
            timeframe: row?.timeframe ? DEFECT_TIMEFRAME_LABELS[row.timeframe as keyof typeof DEFECT_TIMEFRAME_LABELS] : null,
          }
        : null;
      if (vars) for (const [k, v] of Object.entries(attrs)) if (!(k in vars)) vars[k] = v;
      lines.push({ id: e.id, title: e.title ?? "", body: vars ? renderTemplate(text, vars) : text });
    }
    if (tab === "defects") {
      const custom = (result.customComments as { defects?: Array<{ id: string; title: string; comment?: string; included: boolean }> } | undefined)?.defects ?? [];
      for (const d of custom) if (d.included !== false) lines.push({ id: d.id, title: d.title, body: d.comment ?? "" });
    }
    if (lines.length > 0) groups.push({ tab, lines });
  }
  return groups;
}

/**
 * One item for reading only: the heading, the rating as an indicator, the notes as text, the comments that were
 * included, and the photos (a tap opens the viewer). It has no input and nothing that writes, which is why the read-only
 * editor uses it in place of the item editor rather than switching the editor's controls off one by one.
 */
export function ReadOnlyItemView({ item, sectionTitle, result, ratingLevels, inspectionId, coverKey, onOpenPhoto, videoPosterUrl, pendingPhotoUrl }: ReadOnlyItemViewProps) {
  const { urls } = useFieldDataSource();
  if (!item) return null;
  const rating = typeof result.rating === "string" ? result.rating : null;
  const level = findRatingLevel(ratingLevels, rating);
  const notes = typeof result.notes === "string" ? result.notes : "";
  const value = result.value === undefined || result.value === null || result.value === "" ? null : String(result.value);
  const groups = includedByTab(item, result);
  return (
    <div className="max-w-2xl space-y-6" data-testid="read-only-item">
      <ItemHeading sectionTitle={sectionTitle} label={item.label ?? item.name ?? ""} description={item.description} />
      {rating && (
        <p data-testid="read-only-rating" className="inline-block px-2.5 py-1 rounded-full text-[12px] font-bold bg-ih-bg-muted text-ih-fg-1">
          {level?.label ?? level?.name ?? rating}
        </p>
      )}
      {value && <p className="text-[13px] text-ih-fg-1">{value}</p>}
      {groups.map((g) => (
        <div key={g.tab} data-testid={`read-only-${g.tab}`}>
          <span className={SECTION}>{TAB_LABELS[g.tab]()}</span>
          <ul className="mt-1 space-y-2">
            {g.lines.map((l) => (
              <li key={l.id} className="text-[12px] text-ih-fg-2">
                {l.title && <span className="font-bold text-ih-fg-1">{l.title}</span>}
                {l.body && <p className="mt-0.5 leading-relaxed whitespace-pre-wrap">{l.body}</p>}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {notes && (
        <div>
          <span className={SECTION}>{m.editor_item_notes_label()}</span>
          <p data-testid="read-only-notes" className="mt-1 text-[13px] text-ih-fg-1 whitespace-pre-wrap leading-relaxed">{notes}</p>
        </div>
      )}
      <ItemPhotoStrip
        inspectionId={inspectionId}
        itemId={item.id}
        photos={((result.photos as StripPhoto[]) ?? []).filter(Boolean)}
        coverKey={coverKey}
        photoUrl={(k) => urls.photo(inspectionId, k)}
        onOpen={(i) => onOpenPhoto?.(item.id, i)}
        videoPosterUrl={videoPosterUrl}
        pendingPhotoUrl={pendingPhotoUrl}
      />
    </div>
  );
}
