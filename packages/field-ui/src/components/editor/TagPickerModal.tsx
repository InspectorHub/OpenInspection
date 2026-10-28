import { Modal } from "@core/shared-ui";
import { m } from "../../i18n";
import { readableTextOn, safeCssColor } from "../../lib/readable-text";

export interface TagPickerModalProps {
 open: boolean;
 activeItemId: string;
 tagsByItem: Record<string, Array<{ id: string; name: string; color?: string }>>;
 presetTags: Array<{ id: string; name: string; color: string }>;
 onToggle: (tag: { id: string; name: string; color: string }) => void;
 onClose: () => void;
}

export function TagPickerModal({ open, activeItemId, tagsByItem, presetTags, onToggle, onClose }: TagPickerModalProps) {
 const selected = tagsByItem[activeItemId] || [];
 return (
 <Modal open={open} onClose={onClose} title={m.editor_tagpicker_title()} size="sm">
  <div className="space-y-1.5">
   {presetTags.length === 0 && <p className="text-[13px] text-ih-fg-3">{m.editor_tagpicker_empty()}</p>}
   {presetTags.map((tag) => {
   const isActive = selected.some(t => t.id === tag.id);
   return (
    <button
    key={tag.id}
    onClick={() => onToggle(tag)}
    className={`w-full text-left px-3 py-2.5 rounded-lg text-[13px] font-medium flex items-center gap-3 transition-colors ${
     isActive
     ? "bg-ih-bg-muted ring-1 ring-inset"
     : "hover:bg-ih-bg-muted"
    }`}
    style={isActive && safeCssColor(tag.color) ? { "--tw-ring-color": safeCssColor(tag.color) } as React.CSSProperties : undefined}
    >
    <span
     className="w-3 h-3 rounded-full flex-shrink-0 bg-ih-border-strong"
     style={safeCssColor(tag.color) ? { backgroundColor: safeCssColor(tag.color) as string } : undefined}
    />
    <span className="flex-1 text-ih-fg-1">{tag.name}</span>
    {isActive && (
     <svg className="w-4 h-4 text-ih-ok" fill="none" stroke="currentColor" viewBox="0 0 24 24">
     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
     </svg>
    )}
    </button>
   );
   })}
  </div>
  {selected.length > 0 && (
   <div className="mt-3 pt-3 border-t border-ih-border">
   <div className="flex flex-wrap gap-1.5">
    {selected.map(tag => (
    <span
     key={tag.id}
     className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold text-white"
     style={{ backgroundColor: safeCssColor(tag.color) ?? '#6b7280', color: readableTextOn(safeCssColor(tag.color) ?? '#6b7280') ?? undefined }}
    >
     {tag.name}
    </span>
    ))}
   </div>
   </div>
  )}
 </Modal>
 );
}
