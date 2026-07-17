import { ITEM_TYPES } from "./types";
import type { TemplateItem } from "./types";
import { m } from "~/paraglide/messages";

export interface ItemPropertiesPanelProps {
  selectedItem: TemplateItem;
  updateItem: (itemId: string, patch: Partial<TemplateItem>) => void;
  choicesText: string;
  setChoicesText: React.Dispatch<React.SetStateAction<string>>;
}

export function ItemPropertiesPanel({ selectedItem, updateItem, choicesText, setChoicesText }: ItemPropertiesPanelProps) {
  return (
    <>
      <div>
        <label className="block text-[10px] font-bold uppercase tracking-widest text-ih-fg-4 mb-1">{m.templates_item_label()}</label>
        <input value={selectedItem.label} onChange={(e) => updateItem(selectedItem.id, { label: e.target.value })} className="w-full h-8 px-2 rounded border border-ih-border text-[12px] bg-transparent outline-none" />
      </div>
      <div>
        <label className="block text-[10px] font-bold uppercase tracking-widest text-ih-fg-4 mb-1">{m.templates_item_description()}</label>
        <textarea value={selectedItem.description || ""} onChange={(e) => updateItem(selectedItem.id, { description: e.target.value })} rows={2} className="w-full px-2 py-1 rounded border border-ih-border text-[12px] bg-transparent outline-none" />
      </div>
      <div>
        <label className="block text-[10px] font-bold uppercase tracking-widest text-ih-fg-4 mb-1">{m.templates_item_type()}</label>
        <select value={selectedItem.type} onChange={(e) => updateItem(selectedItem.id, { type: e.target.value })} className="w-full h-8 px-2 rounded border border-ih-border text-[12px] bg-transparent outline-none">
          {ITEM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={!!selectedItem.required} onChange={(e) => updateItem(selectedItem.id, { required: e.target.checked })} className="accent-ih-primary" />
        <span className="text-[12px] text-ih-fg-3">{m.templates_item_required()}</span>
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={!!selectedItem.isSafety} onChange={(e) => updateItem(selectedItem.id, { isSafety: e.target.checked })} className="accent-ih-primary" />
        <span className="text-[12px] text-ih-fg-3">{m.templates_item_safety()}</span>
      </label>
      {(selectedItem.type === "select" || selectedItem.type === "multi_select") && (
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-widest text-ih-fg-4 mb-1">{m.templates_item_choices()}</label>
          <textarea
            value={choicesText}
            onChange={(e) => {
              setChoicesText(e.target.value);
              updateItem(selectedItem.id, {
                options: { ...selectedItem.options, choices: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) },
              });
            }}
            rows={4}
            className="w-full px-2 py-1 rounded border border-ih-border text-[12px] bg-transparent outline-none font-mono"
          />
        </div>
      )}
      {selectedItem.type === "number" && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest text-ih-fg-4 mb-1">{m.templates_item_min()}</label>
            <input type="number" value={selectedItem.options?.min ?? ""} onChange={(e) => updateItem(selectedItem.id, { options: { ...selectedItem.options, min: e.target.value ? Number(e.target.value) : null } })} className="w-full h-8 px-2 rounded border border-ih-border text-[12px] bg-transparent outline-none" />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest text-ih-fg-4 mb-1">{m.templates_item_max()}</label>
            <input type="number" value={selectedItem.options?.max ?? ""} onChange={(e) => updateItem(selectedItem.id, { options: { ...selectedItem.options, max: e.target.value ? Number(e.target.value) : null } })} className="w-full h-8 px-2 rounded border border-ih-border text-[12px] bg-transparent outline-none" />
          </div>
        </div>
      )}
      <div>
        <label className="block text-[10px] font-bold uppercase tracking-widest text-ih-fg-4 mb-1">{m.templates_item_default_recommendation()}</label>
        <input value={selectedItem.defaultRecommendation || ""} onChange={(e) => updateItem(selectedItem.id, { defaultRecommendation: e.target.value })} className="w-full h-8 px-2 rounded border border-ih-border text-[12px] bg-transparent outline-none" />
      </div>
    </>
  );
}
