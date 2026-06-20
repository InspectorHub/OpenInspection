import { Link } from "react-router";
import { TemplateIcon } from "./TemplateIcon";
import { countItems, type Template } from "./types";

interface TemplatesListViewProps {
  filtered: Template[];
  searchQuery: string;
  setImportOpen: (open: boolean) => void;
  setCreateOpen: (open: boolean) => void;
  handleDuplicate: (t: Template) => void;
  setDeleteConfirm: (id: string | null) => void;
}

export function TemplatesListView({
  filtered,
  searchQuery,
  setImportOpen,
  setCreateOpen,
  handleDuplicate,
  setDeleteConfirm,
}: TemplatesListViewProps) {
  return (
    <div className="bg-ih-bg-card border border-ih-border rounded-lg overflow-hidden">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-ih-border">
            <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">Name</th>
            <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">Version</th>
            <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">Items</th>
            <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 ? (
            <tr>
              <td colSpan={4}>
                {searchQuery ? (
                  <p className="py-12 text-center text-[13px] text-ih-fg-3">No templates match your search.</p>
                ) : (
                  <div className="py-14 flex flex-col items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-ih-primary-tint flex items-center justify-center text-ih-primary">
                      <TemplateIcon size="lg" />
                    </div>
                    <div className="text-center">
                      <p className="text-[15px] font-bold text-ih-fg-1">Start with a template</p>
                      <p className="text-[13px] text-ih-fg-3 mt-1 max-w-xs">
                        Your workspace ships with starter templates — but if you&apos;re migrating, bring your own.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setImportOpen(true)}
                        className="h-9 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 inline-flex items-center gap-2"
                      >
                        &darr; Import from Spectora
                      </button>
                      <button
                        onClick={() => setCreateOpen(true)}
                        className="h-9 px-3 rounded-md border border-ih-border text-[13px] font-bold text-ih-fg-3 hover:bg-ih-bg-muted inline-flex items-center gap-2"
                      >
                        + New template
                      </button>
                    </div>
                  </div>
                )}
              </td>
            </tr>
          ) : (
            filtered.map((t) => {
              const items = countItems(t);
              return (
                <tr key={t.id} className="border-b border-ih-border hover:bg-ih-bg-muted group">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-ih-primary-tint rounded-lg flex items-center justify-center text-ih-primary group-hover:bg-ih-primary group-hover:text-white transition-all shrink-0">
                        <TemplateIcon />
                      </div>
                      <div>
                        <Link to={`/templates/${t.id}/edit`} className="text-[13px] font-bold text-ih-fg-1 hover:text-ih-primary transition-colors">
                          {t.name}
                        </Link>
                        {t.source === "marketplace" && (
                          <span className="ml-2 text-[9px] font-bold uppercase tracking-widest text-ih-info-fg bg-ih-info-bg px-1.5 py-0.5 rounded">Marketplace</span>
                        )}
                        {t.description && (
                          <p className="text-[11px] text-ih-fg-4 mt-0.5 line-clamp-1">{t.description}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <span className="inline-flex items-center rounded border border-ih-primary/20 px-1.5 py-0.5 text-[10px] font-bold bg-ih-primary-tint text-ih-primary">
                      v{t.version || 1}.0
                    </span>
                  </td>
                  <td className="py-3 px-4 text-[13px] text-ih-fg-3 font-bold">
                    {items} items
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="inline-flex items-center gap-3">
                      <Link to={`/templates/${t.id}/edit`} className="text-[11px] font-bold text-ih-primary hover:text-ih-primary">
                        Edit
                      </Link>
                      <button onClick={() => handleDuplicate(t)} className="text-[11px] font-bold text-ih-fg-3 hover:text-ih-primary transition-colors">
                        Duplicate
                      </button>
                      <button onClick={() => setDeleteConfirm(t.id)} className="text-[11px] font-bold text-ih-fg-4 hover:text-ih-bad-fg transition-colors">
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
