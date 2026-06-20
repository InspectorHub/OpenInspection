import type { TemplateSection } from "./types";

export interface SectionRailProps {
  sections: TemplateSection[];
  activeSection: number;
  setActiveSection: React.Dispatch<React.SetStateAction<number>>;
  setEditingItem: React.Dispatch<React.SetStateAction<string | null>>;
  moveSection: (idx: number, dir: -1 | 1) => void;
  removeSection: (idx: number) => void;
  addSection: () => void;
}

export function SectionRail({ sections, activeSection, setActiveSection, setEditingItem, moveSection, removeSection, addSection }: SectionRailProps) {
  return (
    <aside className="w-[200px] shrink-0 border-r border-ih-border bg-ih-bg-muted overflow-y-auto">
      <div className="p-2 space-y-0.5">
        {sections.map((s, i) => (
          <div key={s.id} className={`group flex items-center rounded-md transition-all ${i === activeSection ? "bg-ih-primary-tint" : "hover:bg-ih-bg-muted"}`}>
            <button onClick={() => { setActiveSection(i); setEditingItem(null); }} className={`flex-1 text-left px-3 py-2 text-[13px] truncate ${i === activeSection ? "text-ih-primary font-bold" : "text-ih-fg-3"}`}>
              {s.title}
              <span className="ml-1 text-[10px] opacity-50">{s.items.length}</span>
            </button>
            <div className="hidden group-hover:flex items-center gap-0.5 pr-1">
              <button onClick={() => moveSection(i, -1)} className="text-ih-fg-4 hover:text-ih-fg-2 text-[10px]">&uarr;</button>
              <button onClick={() => moveSection(i, 1)} className="text-ih-fg-4 hover:text-ih-fg-2 text-[10px]">&darr;</button>
              <button onClick={() => removeSection(i)} className="text-ih-fg-4 hover:text-ih-bad-fg text-[10px]">&times;</button>
            </div>
          </div>
        ))}
        <button onClick={addSection} className="w-full text-left px-3 py-2 text-[12px] font-bold text-ih-primary hover:bg-ih-primary-tint rounded-md">
          + Add Section
        </button>
      </div>
    </aside>
  );
}
