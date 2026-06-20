export interface SectionPickerModalProps {
 sectionPickerQuery: string;
 setSectionPickerQuery: (q: string) => void;
 filteredSectionsForPicker: Array<{ idx: number; title: string }>;
 sections: Array<{ items?: unknown[] }>;
 pickSection: (idx: number) => void;
 closeSectionPicker: () => void;
}

export function SectionPickerModal({
 sectionPickerQuery,
 setSectionPickerQuery,
 filteredSectionsForPicker,
 sections,
 pickSection,
 closeSectionPicker,
}: SectionPickerModalProps) {
 return (
 <div className="fixed inset-0 z-[90] flex items-start justify-center pt-[20vh]">
 <div className="absolute inset-0 bg-[rgba(15,23,42,0.4)] backdrop-blur-sm" onClick={() => closeSectionPicker()} />
 <div className="relative w-full max-w-md bg-ih-bg-card rounded-xl shadow-ih-popover border border-ih-border overflow-hidden">
 <div className="px-4 py-3 border-b border-ih-border">
 <input
 id="section-picker-input"
 type="text"
 placeholder="Jump to section..."
 value={sectionPickerQuery}
 onChange={(e) => setSectionPickerQuery(e.target.value)}
 className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-app text-[13px]"
 autoFocus
 />
 </div>
 <div className="max-h-60 overflow-y-auto">
 {filteredSectionsForPicker.map((sec) => (
 <button
 key={sec.idx}
 onClick={() => pickSection(sec.idx)}
 className="w-full text-left px-4 py-2.5 text-[13px] hover:bg-ih-bg-muted flex items-center justify-between"
 >
 <span className="font-medium text-ih-fg-1">{sec.title}</span>
 <span className="text-[11px] text-ih-fg-3">{sections[sec.idx]?.items?.length || 0} items</span>
 </button>
 ))}
 {filteredSectionsForPicker.length === 0 && (
 <p className="text-center text-[13px] text-ih-fg-3 py-6">No sections match</p>
 )}
 </div>
 </div>
 </div>
 );
}
