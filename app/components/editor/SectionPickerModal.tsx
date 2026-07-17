import { useRef } from "react";
import { Modal } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

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
 <Modal open={open} onClose={closeSectionPicker} title={m.editor_sectionpicker_title()} size="md" initialFocusRef={inputRef}>
 <input
 ref={inputRef}
 id="section-picker-input"
 type="text"
 placeholder={m.editor_sectionpicker_placeholder()}
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
 <span className="text-[11px] text-ih-fg-3">{m.editor_sectionpicker_item_count({ count: sections[sec.idx]?.items?.length || 0 })}</span>
 </button>
 ))}
 {filteredSectionsForPicker.length === 0 && (
 <p className="text-center text-[13px] text-ih-fg-3 py-6">{m.editor_sectionpicker_no_match()}</p>
 )}
 </div>
 </Modal>
 );
}
