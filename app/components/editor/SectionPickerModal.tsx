import { useRef } from "react";
import { Modal } from "@core/shared-ui";

export interface SectionPickerModalProps {
 open: boolean;
 sectionPickerQuery: string;
 setSectionPickerQuery: (q: string) => void;
 filteredSectionsForPicker: Array<{ idx: number; title: string }>;
 sections: Array<{ items?: unknown[] }>;
 pickSection: (idx: number) => void;
 closeSectionPicker: () => void;
}

export function SectionPickerModal({
 open,
 sectionPickerQuery,
 setSectionPickerQuery,
 filteredSectionsForPicker,
 sections,
 pickSection,
 closeSectionPicker,
}: SectionPickerModalProps) {
 const inputRef = useRef<HTMLInputElement>(null);
 return (
 <Modal open={open} onClose={closeSectionPicker} title="Jump to section" size="md" initialFocusRef={inputRef}>
 <input
 ref={inputRef}
 id="section-picker-input"
 type="text"
 placeholder="Jump to section..."
 value={sectionPickerQuery}
 onChange={(e) => setSectionPickerQuery(e.target.value)}
 className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-app text-[13px]"
 />
 <div className="mt-3 -mx-4 max-h-60 overflow-y-auto border-t border-ih-border">
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
 </Modal>
 );
}
