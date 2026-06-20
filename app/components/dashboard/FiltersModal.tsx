import { Button } from "@core/shared-ui";

interface FiltersModalProps {
  onClose: () => void;
  filterDateFrom: string;
  filterDateTo: string;
  filterAgentId: string;
  setFilterDateFrom: (v: string) => void;
  setFilterDateTo: (v: string) => void;
  setFilterAgentId: (v: string) => void;
}

export function FiltersModal({
  onClose,
  filterDateFrom,
  filterDateTo,
  filterAgentId,
  setFilterDateFrom,
  setFilterDateTo,
  setFilterAgentId,
}: FiltersModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,23,42,0.4)] backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-sm bg-ih-bg-card rounded-xl shadow-ih-popover p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[16px] font-bold text-ih-fg-1">Filters</h2>
          <button onClick={onClose} className="text-ih-fg-4 hover:text-ih-fg-2 text-lg">&times;</button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-[12px] font-bold text-ih-fg-3 mb-1">Date from</label>
            <input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] outline-none" />
          </div>
          <div>
            <label className="block text-[12px] font-bold text-ih-fg-3 mb-1">Date to</label>
            <input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] outline-none" />
          </div>
          <div>
            <label className="block text-[12px] font-bold text-ih-fg-3 mb-1">Agent ID</label>
            <input type="text" value={filterAgentId} onChange={(e) => setFilterAgentId(e.target.value)} placeholder="Agent ID" className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] outline-none" />
          </div>
        </div>
        <div className="flex items-center justify-between mt-6">
          <Button variant="ghost" size="sm" onClick={() => { setFilterDateFrom(""); setFilterDateTo(""); setFilterAgentId(""); }}>
            Reset
          </Button>
          <Button variant="primary" size="sm" onClick={onClose}>
            Apply
          </Button>
        </div>
      </div>
    </div>
  );
}
