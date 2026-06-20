import { Link } from "react-router";

interface SpectoraMappingModalProps {
  handleMappingDismiss: () => void;
}

export function SpectoraMappingModal({ handleMappingDismiss }: SpectoraMappingModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,23,42,0.4)] backdrop-blur-sm"
      onClick={handleMappingDismiss}
    >
      <div
        className="w-full max-w-md bg-ih-bg-card rounded-xl shadow-ih-popover p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-[17px] font-bold text-ih-fg-1">Coming from Spectora?</h2>
          <button onClick={handleMappingDismiss} className="text-ih-fg-4 hover:text-ih-fg-2 text-lg leading-none">&times;</button>
        </div>
        <p className="text-[12px] text-ih-fg-3 mb-4">Here&apos;s how Spectora concepts map to OpenInspection.</p>

        <div className="divide-y divide-ih-border rounded-lg border border-ih-border overflow-hidden">
          {/* Row 1 */}
          <div className="px-4 py-3">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-[12px] font-bold text-ih-fg-3 line-through">Comments</span>
              <span className="text-ih-fg-4 text-[11px]">&rarr;</span>
              <span className="text-[12px] font-bold text-ih-primary">Defects</span>
              <span className="text-ih-fg-4 text-[10px] font-bold">+</span>
              <span className="text-[12px] font-bold text-ih-primary">Notes</span>
            </div>
            <p className="text-[12px] text-ih-fg-3">Your comment library becomes canned defects; free text lives in Notes.</p>
          </div>
          {/* Row 2 */}
          <div className="px-4 py-3">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-[12px] font-bold text-ih-fg-3 line-through">Rating icons</span>
              <span className="text-ih-fg-4 text-[11px]">&rarr;</span>
              <span className="text-[12px] font-bold text-ih-good-fg">Satisfactory</span>
              <span className="text-ih-fg-4 text-[10px]">&middot;</span>
              <span className="text-[12px] font-bold text-ih-warn-fg">Monitor</span>
              <span className="text-ih-fg-4 text-[10px]">&middot;</span>
              <span className="text-[12px] font-bold text-ih-bad-fg">Defect</span>
            </div>
            <p className="text-[12px] text-ih-fg-3">Ratings are full-word buttons with semantic colors.</p>
          </div>
          {/* Row 3 */}
          <div className="px-4 py-3">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-[12px] font-bold text-ih-fg-3 line-through">Orders</span>
              <span className="text-ih-fg-4 text-[11px]">&rarr;</span>
              <span className="text-[12px] font-bold text-ih-primary">Inspections</span>
              <span className="text-ih-fg-4 text-[10px] font-bold">+</span>
              <span className="text-[12px] font-bold text-ih-primary">Invoices</span>
            </div>
            <p className="text-[12px] text-ih-fg-3">One order = an inspection plus its invoice and agreement.</p>
          </div>
        </div>

        <div className="flex items-center justify-between mt-5">
          <Link
            to="/settings/inspection"
            className="text-[12px] text-ih-fg-3 hover:text-ih-primary underline underline-offset-2"
            onClick={handleMappingDismiss}
          >
            Review editor settings
          </Link>
          <button
            onClick={handleMappingDismiss}
            className="h-8 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
