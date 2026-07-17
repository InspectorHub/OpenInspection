import { Link } from "react-router";
import { Icon } from "@core/shared-ui";
import { TemplateIcon } from "./TemplateIcon";
import { countItems, type Template } from "./types";
import { m } from "~/paraglide/messages";

interface TemplatesCardViewProps {
  filtered: Template[];
  searchQuery: string;
  setImportOpen: (open: boolean) => void;
  setCreateOpen: (open: boolean) => void;
  handleDuplicate: (t: Template) => void;
  setDeleteConfirm: (id: string | null) => void;
}

export function TemplatesCardView({
  filtered,
  searchQuery,
  setImportOpen,
  setCreateOpen,
  handleDuplicate,
  setDeleteConfirm,
}: TemplatesCardViewProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {filtered.length === 0 ? (
        <div className="col-span-full py-16 bg-ih-bg-card rounded-lg border border-ih-border flex flex-col items-center gap-4">
          {searchQuery ? (
            <>
              <p className="font-semibold text-ih-fg-2">{m.templates_card_empty_search_title()}</p>
              <p className="text-[13px] text-ih-fg-3">{m.templates_card_empty_search_body()}</p>
            </>
          ) : (
            <>
              <div className="w-12 h-12 rounded-xl bg-ih-primary-tint flex items-center justify-center text-ih-primary">
                <TemplateIcon size="lg" />
              </div>
              <div className="text-center">
                <p className="text-[15px] font-bold text-ih-fg-1">{m.templates_empty_title()}</p>
                <p className="text-[13px] text-ih-fg-3 mt-1 max-w-xs">
                  {m.templates_empty_body()}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setImportOpen(true)}
                  className="h-9 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 inline-flex items-center gap-2"
                >
                  <Icon name="download" size={16} strokeWidth={1.75} />
                  {m.templates_import_title()}
                </button>
                <button
                  onClick={() => setCreateOpen(true)}
                  className="h-9 px-3 rounded-md border border-ih-border text-[13px] font-bold text-ih-fg-3 hover:bg-ih-bg-muted inline-flex items-center gap-2"
                >
                  {m.templates_empty_new()}
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        filtered.map((t) => {
          const items = countItems(t);
          return (
            <div
              key={t.id}
              className="bg-ih-bg-card border border-ih-border rounded-lg p-3 flex flex-col gap-2 hover:border-ih-primary transition-colors"
            >
              <div>
                <Link to={`/templates/${t.id}/edit`} className="text-[14px] font-bold text-ih-fg-1 hover:text-ih-primary transition-colors">
                  {t.name}
                </Link>
                {t.description && (
                  <p className="text-[11px] text-ih-fg-3 line-clamp-2 mt-1">{t.description}</p>
                )}
              </div>
              <div className="flex items-center gap-2 text-[10px] font-mono text-ih-fg-4">
                <span className="inline-flex items-center rounded border border-ih-primary/20 px-1.5 py-0.5 bg-ih-primary-tint text-ih-primary">
                  v{t.version || 1}.0
                </span>
                <span>{m.templates_row_items({ count: items })}</span>
                <span>{m.templates_card_used({ count: t.usageCount || 0 })}</span>
                {t.source === "marketplace" && (
                  <span className="text-[9px] font-bold uppercase tracking-widest text-ih-info-fg bg-ih-info-bg px-1 py-0.5 rounded">{m.templates_card_badge_mp()}</span>
                )}
              </div>
              <div className="flex items-center gap-3 pt-1 border-t border-ih-border mt-auto">
                <Link to={`/templates/${t.id}/edit`} className="text-[11px] font-bold text-ih-primary hover:text-ih-primary transition-colors">
                  {m.common_edit()}
                </Link>
                <button onClick={() => handleDuplicate(t)} className="text-[11px] font-bold text-ih-fg-3 hover:text-ih-primary transition-colors">
                  {m.templates_action_duplicate()}
                </button>
                <button onClick={() => setDeleteConfirm(t.id)} className="text-[11px] font-bold text-ih-fg-4 hover:text-ih-bad-fg transition-colors ml-auto">
                  {m.common_delete()}
                </button>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
