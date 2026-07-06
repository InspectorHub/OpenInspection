import { Button, Drawer } from "@core/shared-ui";

interface FiltersDrawerProps {
  open: boolean;
  onClose: () => void;
  filterDateFrom: string;
  filterDateTo: string;
  filterAgentId: string;
  setFilterDateFrom: (v: string) => void;
  setFilterDateTo: (v: string) => void;
  setFilterAgentId: (v: string) => void;
}

export function FiltersDrawer({
  open,
  onClose,
  filterDateFrom,
  filterDateTo,
  filterAgentId,
  setFilterDateFrom,
  setFilterDateTo,
  setFilterAgentId,
}: FiltersDrawerProps) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Filters"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => { setFilterDateFrom(""); setFilterDateTo(""); setFilterAgentId(""); }}>
            Reset
          </Button>
          <Button variant="primary" size="sm" onClick={onClose}>
            Apply
          </Button>
        </>
      }
    >
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
    </Drawer>
  );
}
