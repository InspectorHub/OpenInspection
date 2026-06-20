export interface TagPickerModalProps {
 activeItemId: string;
 tagsByItem: Record<string, Array<{ id: string; name: string; color?: string }>>;
 presetTags: Array<{ id: string; name: string; color: string }>;
 onToggle: (tag: { id: string; name: string; color: string }) => void;
 onClose: () => void;
}

export function TagPickerModal({ activeItemId, tagsByItem, presetTags, onToggle, onClose }: TagPickerModalProps) {
 return (
 <div className="fixed inset-0 z-[95] flex items-start justify-center pt-[20vh]">
  <div className="absolute inset-0 bg-[rgba(15,23,42,0.4)] backdrop-blur-sm" onClick={onClose} />
  <div className="relative w-full max-w-sm bg-ih-bg-card rounded-xl shadow-ih-popover border border-ih-border overflow-hidden">
  <div className="px-4 py-3 border-b border-ih-border flex items-center justify-between">
   <h3 className="text-[14px] font-bold text-ih-fg-1">Tags</h3>
   <button
   onClick={onClose}
   className="text-ih-fg-4 hover:text-ih-fg-2 text-lg"
   >
   &#x2715;
   </button>
  </div>
  <div className="p-3 space-y-1.5">
   {presetTags.map((tag) => {
   const currentTags = tagsByItem[activeItemId] || [];
   const isActive = currentTags.some(t => t.id === tag.id);
   return (
    <button
    key={tag.id}
    onClick={() => onToggle(tag)}
    className={`w-full text-left px-3 py-2.5 rounded-lg text-[13px] font-medium flex items-center gap-3 transition-colors ${
     isActive
     ? "bg-ih-bg-muted ring-1 ring-inset"
     : "hover:bg-ih-bg-muted"
    }`}
    style={isActive ? { "--tw-ring-color": tag.color } as React.CSSProperties : undefined}
    >
    <span
     className="w-3 h-3 rounded-full flex-shrink-0"
     style={{ backgroundColor: tag.color }}
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
  {(tagsByItem[activeItemId] || []).length > 0 && (
   <div className="px-4 py-2 border-t border-ih-border">
   <div className="flex flex-wrap gap-1.5">
    {(tagsByItem[activeItemId] || []).map(tag => (
    <span
     key={tag.id}
     className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold text-white"
     style={{ backgroundColor: tag.color || '#6b7280' }}
    >
     {tag.name}
    </span>
    ))}
   </div>
   </div>
  )}
  </div>
 </div>
 );
}
