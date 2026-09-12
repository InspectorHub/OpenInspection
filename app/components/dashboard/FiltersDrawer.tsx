import { Button, Drawer } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

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
      title={m.dashboard_filters_title()}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => { setFilterDateFrom(""); setFilterDateTo(""); setFilterAgentId(""); }}>
            {m.dashboard_filters_reset()}
          </Button>
          <Button variant="primary" size="sm" onClick={onClose}>
            {m.dashboard_filters_apply()}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="block text-[12px] font-bold text-ih-fg-3 mb-1">{m.dashboard_filters_date_from()}</label>
          {/* IA-88 ⑥ — `lang` on the control itself, the way the hub's own date
              and datetime fields carry it. Without it the native picker draws
              its placeholder and part order in the BROWSER's language, so an
              English page could show a Japanese or Chinese date order; inheriting
              from `<html lang>` does not reach it. */}
          <input type="date" lang="en" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] outline-none" />
        </div>
        <div>
          <label className="block text-[12px] font-bold text-ih-fg-3 mb-1">{m.dashboard_filters_date_to()}</label>
          <input type="date" lang="en" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] outline-none" />
        </div>
        <div>
          <label className="block text-[12px] font-bold text-ih-fg-3 mb-1">{m.dashboard_filters_agent_id()}</label>
          <input type="text" value={filterAgentId} onChange={(e) => setFilterAgentId(e.target.value)} placeholder={m.dashboard_filters_agent_id()} className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] outline-none" />
        </div>
      </div>
    </Drawer>
  );
}
