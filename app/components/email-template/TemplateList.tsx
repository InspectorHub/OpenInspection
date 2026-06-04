import { Link, useFetcher } from "react-router";

export interface TemplateRow {
  trigger: string; name: string; category: string; required: boolean; enabled: boolean; isCustomized: boolean; subject: string;
}

const GROUPS: { key: string; label: string }[] = [
  { key: "client", label: "Client" },
  { key: "agent", label: "Agent" },
  { key: "concierge", label: "Concierge" },
  { key: "system", label: "Workspace" },
];

export function TemplateList({ rows }: { rows: TemplateRow[] }) {
  return (
    <div className="space-y-6">
      {GROUPS.map((g) => {
        const items = rows.filter((r) => r.category === g.key);
        if (!items.length) return null;
        return (
          <div key={g.key}>
            <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-4 mb-2 px-1">{g.label}</h4>
            <div className="bg-ih-bg-card border border-ih-border rounded-lg divide-y divide-ih-border overflow-hidden">
              {items.map((r) => <TemplateRowItem key={r.trigger} row={r} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TemplateRowItem({ row }: { row: TemplateRow }) {
  const fetcher = useFetcher();
  const enabled = fetcher.formData ? fetcher.formData.get("enabled") === "true" : row.enabled;
  return (
    <div className="group flex items-center gap-4 px-5 py-3.5 hover:bg-ih-bg-muted/60 transition-colors">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Link to={`/settings/communication/templates/${row.trigger}`} className="text-[13px] font-semibold text-ih-fg-1 hover:text-ih-primary transition-colors truncate">{row.name}</Link>
          {row.isCustomized && <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-ih-primary-tint text-ih-primary">Customized</span>}
          {row.required && <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-ih-bg-muted text-ih-fg-4">Always on</span>}
        </div>
        <p className="text-[11px] text-ih-fg-4 mt-0.5 font-mono truncate">{row.subject}</p>
      </div>
      {row.required ? (
        <span className="text-[10px] font-bold uppercase tracking-widest text-ih-ok-fg shrink-0">Active</span>
      ) : row.isCustomized ? (
        <span className={`text-[10px] font-bold uppercase tracking-widest shrink-0 ${enabled ? "text-ih-ok-fg" : "text-ih-fg-4"}`}>{enabled ? "Active" : "Disabled"}</span>
      ) : (
        <fetcher.Form method="post" className="shrink-0">
          <input type="hidden" name="intent" value="toggle-template" />
          <input type="hidden" name="trigger" value={row.trigger} />
          <input type="hidden" name="enabled" value={(!enabled).toString()} />
          <button type="submit" aria-pressed={enabled} aria-label={`${enabled ? "Disable" : "Enable"} ${row.name}`} className={`relative h-5 w-9 rounded-full transition-colors ${enabled ? "bg-ih-primary" : "bg-ih-border"}`}>
            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all ${enabled ? "left-[18px]" : "left-0.5"}`} />
          </button>
        </fetcher.Form>
      )}
      <Link to={`/settings/communication/templates/${row.trigger}`} className="shrink-0 h-7 px-3 rounded-md border border-ih-border text-[12px] font-medium text-ih-fg-2 hover:bg-ih-bg-card hover:border-ih-primary hover:text-ih-primary transition-colors">Edit</Link>
    </div>
  );
}
