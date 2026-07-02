import { useMemo, useRef, useState } from "react";
import type { TemplateItem, TemplateSection } from "./types";
import { CannedCommentRow } from "../editor-shared/CannedCommentRow";
import { CommentTypeahead } from "../editor/CommentTypeahead";
import { useCommentTypeahead } from "../../hooks/useCommentTypeahead";
import {
  flattenItemTabs,
  fragmentBeforeCaret,
  replaceFragmentBeforeCaret,
} from "../../lib/comment-typeahead";

export interface ItemCommentsPanelProps {
  selectedItem: TemplateItem;
  activeSection: number;
  editingItem: string | null;
  updateSections: (fn: (s: TemplateSection[]) => TemplateSection[]) => void;
  addCannedToItem: (tab: "information" | "limitations" | "defects") => void;
  removeCannedFromItem: (tab: "information" | "limitations" | "defects", idx: number) => void;
}

type CannedTab = "information" | "limitations" | "defects";

export function ItemCommentsPanel({ selectedItem, activeSection, editingItem, updateSections, addCannedToItem, removeCannedFromItem }: ItemCommentsPanelProps) {
  // Inline comment typeahead (authoring assist) hosted ONCE at panel level and
  // keyed to the focused row. Source = this item's Tier-1 canned entries, same
  // as the inspection-side notes typeahead (mirrors ItemEditor's pattern).
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [taQuery, setTaQuery] = useState("");
  const [taOpen, setTaOpen] = useState(false);
  const activeElRef = useRef<HTMLTextAreaElement | null>(null);

  const taEntries = useMemo(() => flattenItemTabs(selectedItem.tabs), [selectedItem.tabs]);
  const ta = useCommentTypeahead(taEntries, taQuery, { max: 8 });

  const insertPick = (tab: CannedTab, ci: number, currentValue: string, replacement: string) => {
    const el = activeElRef.current;
    const caret = el?.selectionStart ?? currentValue.length;
    const next = replaceFragmentBeforeCaret(currentValue, caret, replacement);
    updateSections((s) => {
      const it = s[activeSection].items.find((i) => i.id === editingItem);
      if (it?.tabs?.[tab]?.[ci]) it.tabs[tab][ci].comment = next.value;
      return s;
    });
    setTaOpen(false);
    setTaQuery("");
    requestAnimationFrame(() => {
      if (el) { el.focus(); el.setSelectionRange(next.caret, next.caret); }
    });
  };

  return (
    <>
      {(["information", "limitations", "defects"] as const).map((tab) => (
        <div key={tab}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-ih-fg-4 capitalize">{tab}</span>
            <button onClick={() => addCannedToItem(tab)} className="text-[10px] font-bold text-ih-primary hover:text-ih-primary">+ Add</button>
          </div>
          {(selectedItem.tabs?.[tab] || []).map((c, ci, arr) => {
            const key = `${tab}:${ci}`;
            return (
              <CannedCommentRow
                key={c.id}
                as="div"
                interactive={false}
                leading={
                  <div className="flex flex-col gap-0.5 pt-0.5">
                    <button
                      aria-label="Move up"
                      disabled={ci === 0}
                      onClick={() => updateSections((s) => {
                        const it = s[activeSection].items.find((i) => i.id === editingItem);
                        const a = it?.tabs?.[tab];
                        if (a && ci > 0) { const [m] = a.splice(ci, 1); a.splice(ci - 1, 0, m); }
                        return s;
                      })}
                      className="text-[10px] text-ih-fg-4 hover:text-ih-fg-2 disabled:opacity-30"
                    >▲</button>
                    <button
                      aria-label="Move down"
                      disabled={ci === arr.length - 1}
                      onClick={() => updateSections((s) => {
                        const it = s[activeSection].items.find((i) => i.id === editingItem);
                        const a = it?.tabs?.[tab];
                        if (a && ci < a.length - 1) { const [m] = a.splice(ci, 1); a.splice(ci + 1, 0, m); }
                        return s;
                      })}
                      className="text-[10px] text-ih-fg-4 hover:text-ih-fg-2 disabled:opacity-30"
                    >▼</button>
                  </div>
                }
                titleSlot={
                  <input
                    value={c.title}
                    onChange={(e) => {
                      updateSections((s) => {
                        const it = s[activeSection].items.find((i) => i.id === editingItem);
                        if (it?.tabs?.[tab]?.[ci]) it.tabs[tab][ci].title = e.target.value;
                        return s;
                      });
                    }}
                    placeholder="Title"
                    className="w-full text-[11px] font-bold bg-transparent border-b border-ih-border outline-none text-ih-fg-2 mb-0.5"
                  />
                }
                trailing={
                  <button
                    onClick={() => removeCannedFromItem(tab, ci)}
                    className="text-ih-fg-4 hover:text-ih-bad-fg text-[10px] mt-1"
                    aria-label="Delete comment"
                  >
                    &times;
                  </button>
                }
                bodySlot={
                  <div className="mt-0.5">
                    <input
                      value={c.abbrev ?? ""}
                      onChange={(e) => {
                        updateSections((s) => {
                          const it = s[activeSection].items.find((i) => i.id === editingItem);
                          if (it?.tabs?.[tab]?.[ci]) it.tabs[tab][ci].abbrev = e.target.value.slice(0, 12);
                          return s;
                        });
                      }}
                      placeholder="abbr"
                      maxLength={12}
                      title="Shortcode — type this in the report to fill this comment"
                      className="w-16 text-[10px] font-mono bg-transparent border-b border-ih-border outline-none text-ih-fg-3 mb-0.5"
                    />
                    <div className="relative">
                      <textarea
                        value={c.comment}
                        onFocus={(e) => { activeElRef.current = e.currentTarget; setActiveKey(key); }}
                        onChange={(e) => {
                          const val = e.target.value;
                          const caret = e.target.selectionStart ?? 0;
                          updateSections((s) => {
                            const it = s[activeSection].items.find((i) => i.id === editingItem);
                            if (it?.tabs?.[tab]?.[ci]) it.tabs[tab][ci].comment = val;
                            return s;
                          });
                          const frag = fragmentBeforeCaret(val, caret);
                          setActiveKey(key);
                          setTaQuery(frag);
                          setTaOpen(frag.trim().length >= 2);
                        }}
                        onBlur={() => setTaOpen(false)}
                        onKeyDown={(e) => {
                          if (activeKey === key && taOpen && ta.matches.length > 0) {
                            if (e.key === "ArrowDown") { e.preventDefault(); ta.move(1); return; }
                            if (e.key === "ArrowUp") { e.preventDefault(); ta.move(-1); return; }
                            if (e.key === "Enter" || e.key === "Tab") {
                              const pick = ta.current();
                              if (pick) { e.preventDefault(); insertPick(tab, ci, c.comment, pick.comment); return; }
                            }
                            if (e.key === "Escape") { e.preventDefault(); setTaOpen(false); return; }
                          }
                        }}
                        placeholder="Comment text..."
                        rows={2}
                        className="w-full text-[11px] bg-transparent border border-ih-border rounded px-1 py-0.5 outline-none text-ih-fg-3"
                      />
                      <CommentTypeahead
                        entries={taEntries}
                        matches={ta.matches}
                        query={taQuery}
                        open={taOpen && activeKey === key}
                        selectedIndex={ta.selectedIndex}
                        onHoverIndex={ta.setSelectedIndex}
                        onPick={(text) => insertPick(tab, ci, c.comment, text)}
                        onClose={() => setTaOpen(false)}
                      />
                    </div>
                  </div>
                }
              />
            );
          })}
        </div>
      ))}
    </>
  );
}
