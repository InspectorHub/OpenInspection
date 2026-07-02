import type { TemplateItem } from "./types";
import { CannedCommentRow } from "../editor-shared/CannedCommentRow";

export interface ItemPreviewPanelProps {
  selectedItem: TemplateItem;
}

export function ItemPreviewPanel({ selectedItem }: ItemPreviewPanelProps) {
  return (
    <div className="space-y-2">
      <p className="text-[13px] font-bold text-ih-fg-1">{selectedItem.label}</p>
      {selectedItem.description && <p className="text-[11px] text-ih-fg-3">{selectedItem.description}</p>}
      <div className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-ih-bg-muted text-ih-fg-3 inline-block">{selectedItem.type}</div>
      {selectedItem.type === "rich" && selectedItem.ratingOptions && (
        <div className="flex flex-wrap gap-1 mt-2">
          {selectedItem.ratingOptions.map((opt) => (
            <span key={opt} className="text-[10px] px-2 py-1 rounded border border-ih-border text-ih-fg-3">{opt}</span>
          ))}
        </div>
      )}
      {selectedItem.tabs && selectedItem.type === "rich" && (
        <div className="space-y-2 mt-3">
          {(["information", "limitations", "defects"] as const).map((tab) => {
            const entries = selectedItem.tabs?.[tab] || [];
            if (entries.length === 0) return null;
            return (
              <div key={tab}>
                <p className="text-[10px] font-bold uppercase tracking-widest text-ih-fg-4 mb-1 capitalize">{tab}</p>
                {entries.map((c) => (
                  <CannedCommentRow
                    key={c.id}
                    as="div"
                    interactive={false}
                    selected={false}
                    title={c.title}
                    category={tab === "defects" ? c.category : undefined}
                    bodySlot={c.comment ? <p className="text-[11px] mt-0.5 leading-relaxed text-ih-fg-3">{c.comment}</p> : null}
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
