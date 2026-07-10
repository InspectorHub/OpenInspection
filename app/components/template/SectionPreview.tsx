import type { TemplateSection } from "./types";

export interface SectionPreviewProps {
  section: TemplateSection;
}

/** Read-only preview of a section's items (label, description, type badge, rating options). */
export function SectionPreview({ section }: SectionPreviewProps) {
  return (
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
  );
}
