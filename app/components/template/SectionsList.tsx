import { ITEM_TYPES } from "./types";
import type { TemplateItem, TemplateSection } from "./types";

export interface SectionsListProps {
  section: TemplateSection | null;
  activeSection: number;
  previewMode: boolean;
  editingItem: string | null;
  renameSection: (idx: number, title: string) => void;
  updateSections: (fn: (s: TemplateSection[]) => TemplateSection[]) => void;
  setEditingItem: React.Dispatch<React.SetStateAction<string | null>>;
  setRightRail: React.Dispatch<React.SetStateAction<"properties" | "comments" | "preview">>;
  updateItem: (itemId: string, patch: Partial<TemplateItem>) => void;
  moveItem: (itemIdx: number, dir: -1 | 1) => void;
  removeItem: (itemId: string) => void;
  addItem: () => void;
}

export function SectionsList({ section, activeSection, previewMode, editingItem, renameSection, updateSections, setEditingItem, setRightRail, updateItem, moveItem, removeItem, addItem }: SectionsListProps) {
  return (
    <>
      {section ? (
        <div className="max-w-2xl mx-auto space-y-3">
          {/* Section title inline edit */}
          <div className="flex items-center gap-2">
            <input
              value={section.title}
              onChange={(e) => renameSection(activeSection, e.target.value)}
              className="text-[18px] font-bold bg-transparent border-b-2 border-transparent focus:border-ih-primary outline-none flex-1 text-ih-fg-1"
            />
            <span className="text-[11px] text-ih-fg-4">{section.items.length} items</span>
          </div>

          {/* Section disclaimer */}
          <input
            value={section.disclaimerText || ""}
            onChange={(e) => updateSections((s) => { s[activeSection].disclaimerText = e.target.value; return s; })}
            placeholder="Section disclaimer (optional)"
            className="w-full text-[12px] text-ih-fg-4 bg-transparent border-b border-transparent focus:border-ih-border-strong outline-none"
          />

          {/* Items */}
          {previewMode ? (
            <div className="space-y-2">
              {section.items.map((item, idx) => (
                <div key={item.id} className="bg-ih-bg-card border border-ih-border rounded-lg p-4">
                  <p className="text-[13px] font-bold text-ih-fg-1">
                    {idx + 1}. {item.label}
                  </p>
                  {item.description && <p className="text-[11px] text-ih-fg-4 mt-1">{item.description}</p>}
                  <div className="mt-2">
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-ih-bg-muted text-ih-fg-3">{item.type}</span>
                    {item.type === "rich" && item.ratingOptions && (
                      <div className="flex gap-1 mt-2">
                        {item.ratingOptions.map((opt) => (
                          <span key={opt} className="text-[10px] px-2 py-0.5 rounded border border-ih-border text-ih-fg-3">{opt}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <>
              {section.items.map((item, idx) => (
                <div
                  key={item.id}
                  className={`bg-ih-bg-card border rounded-lg p-3 transition-colors ${editingItem === item.id ? "border-ih-primary shadow-ih-focus" : "border-ih-border"}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="text-[10px] font-mono text-ih-fg-4 w-5 cursor-grab" title="Drag to reorder">&#9776;</span>
                      <span className="text-[10px] font-mono text-ih-fg-4 w-5">{String(idx + 1).padStart(2, "0")}</span>
                      {editingItem === item.id ? (
                        <input
                          value={item.label}
                          onChange={(e) => updateItem(item.id, { label: e.target.value })}
                          autoFocus
                          className="flex-1 text-[13px] font-medium bg-transparent border-b border-ih-primary outline-none text-ih-fg-1"
                        />
                      ) : (
                        <button
                          onClick={() => { setEditingItem(item.id); setRightRail("properties"); }}
                          className="flex-1 text-left text-[13px] font-medium text-ih-fg-1 truncate hover:text-ih-primary"
                        >
                          {item.label}
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0 ml-2">
                      <select
                        value={item.type}
                        onChange={(e) => updateItem(item.id, { type: e.target.value })}
                        className="h-6 px-1 rounded text-[10px] font-bold bg-ih-bg-muted text-ih-fg-3 border-0 outline-none"
                      >
                        {ITEM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <button onClick={() => moveItem(idx, -1)} className="w-5 h-5 text-ih-fg-4 hover:text-ih-fg-2 text-[10px]">&uarr;</button>
                      <button onClick={() => moveItem(idx, 1)} className="w-5 h-5 text-ih-fg-4 hover:text-ih-fg-2 text-[10px]">&darr;</button>
                      <button onClick={() => removeItem(item.id)} className="w-5 h-5 text-ih-fg-4 hover:text-ih-bad-fg text-[10px]">&times;</button>
                    </div>
                  </div>
                </div>
              ))}

              <button onClick={addItem} className="w-full py-2 rounded-lg border-2 border-dashed border-ih-border text-[12px] font-bold text-ih-fg-3 hover:border-ih-primary hover:text-ih-primary transition-colors">
                + Add Item
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-center h-full text-[13px] text-ih-fg-4">
          Add a section to get started
        </div>
      )}
    </>
  );
}
