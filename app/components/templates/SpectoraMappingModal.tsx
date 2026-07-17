import { Link } from "react-router";
import { Modal } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

interface SpectoraMappingModalProps {
  open: boolean;
  handleMappingDismiss: () => void;
}

export function SpectoraMappingModal({ open, handleMappingDismiss }: SpectoraMappingModalProps) {
  return (
    <Modal
      open={open}
      onClose={handleMappingDismiss}
      title={m.templates_mapping_title()}
      size="md"
      footer={
        <div className="flex items-center justify-between w-full">
          <Link
            to="/settings/inspection"
            className="text-[12px] text-ih-fg-3 hover:text-ih-primary underline underline-offset-2"
            onClick={handleMappingDismiss}
          >
            {m.templates_mapping_review_settings()}
          </Link>
          <button
            type="button"
            onClick={handleMappingDismiss}
            className="h-8 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600"
          >
            {m.templates_mapping_dismiss()}
          </button>
        </div>
      }
    >
      <p className="text-[12px] text-ih-fg-3 mb-4">{m.templates_mapping_intro()}</p>

      <div className="divide-y divide-ih-border rounded-lg border border-ih-border overflow-hidden">
        {/* Row 1 */}
        <div className="px-4 py-3">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[12px] font-bold text-ih-fg-3 line-through">{m.templates_mapping_row1_from()}</span>
            <span className="text-ih-fg-4 text-[11px]">&rarr;</span>
            <span className="text-[12px] font-bold text-ih-primary">{m.templates_mapping_row1_to1()}</span>
            <span className="text-ih-fg-4 text-[10px] font-bold">+</span>
            <span className="text-[12px] font-bold text-ih-primary">{m.templates_mapping_row1_to2()}</span>
          </div>
          <p className="text-[12px] text-ih-fg-3">{m.templates_mapping_row1_desc()}</p>
        </div>
        {/* Row 2 */}
        <div className="px-4 py-3">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[12px] font-bold text-ih-fg-3 line-through">{m.templates_mapping_row2_from()}</span>
            <span className="text-ih-fg-4 text-[11px]">&rarr;</span>
            <span className="text-[12px] font-bold text-ih-good-fg">{m.templates_mapping_row2_to1()}</span>
            <span className="text-ih-fg-4 text-[10px]">&middot;</span>
            <span className="text-[12px] font-bold text-ih-watch-fg">{m.templates_mapping_row2_to2()}</span>
            <span className="text-ih-fg-4 text-[10px]">&middot;</span>
            <span className="text-[12px] font-bold text-ih-bad-fg">{m.templates_mapping_row2_to3()}</span>
          </div>
          <p className="text-[12px] text-ih-fg-3">{m.templates_mapping_row2_desc()}</p>
        </div>
        {/* Row 3 */}
        <div className="px-4 py-3">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[12px] font-bold text-ih-fg-3 line-through">{m.templates_mapping_row3_from()}</span>
            <span className="text-ih-fg-4 text-[11px]">&rarr;</span>
            <span className="text-[12px] font-bold text-ih-primary">{m.templates_mapping_row3_to1()}</span>
            <span className="text-ih-fg-4 text-[10px] font-bold">+</span>
            <span className="text-[12px] font-bold text-ih-primary">{m.templates_mapping_row3_to2()}</span>
          </div>
          <p className="text-[12px] text-ih-fg-3">{m.templates_mapping_row3_desc()}</p>
        </div>
      </div>
    </Modal>
  );
}
