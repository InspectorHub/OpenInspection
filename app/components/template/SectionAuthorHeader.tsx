import type { TemplateSection } from "./types";

export interface SectionAuthorHeaderProps {
  section: TemplateSection;
  activeSection: number;
  renameSection: (idx: number, title: string) => void;
  updateSections: (fn: (s: TemplateSection[]) => TemplateSection[]) => void;
}

/** Section title + item count + disclaimer inline editors, shown above the item nav column. */
export function SectionAuthorHeader({ section, activeSection, renameSection, updateSections }: SectionAuthorHeaderProps) {
  return (
    <div className="p-3 border-b border-ih-border space-y-2 shrink-0">
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
    </div>
  );
}
