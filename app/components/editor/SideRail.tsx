import { useState } from "react";
import { renderTemplate } from "../../lib/mustache";
import { DEFECT_TRADE_LABELS, DEFECT_DEADLINE_LABELS, DEFECT_TIMEFRAME_LABELS } from "../../lib/defect-fields";
import { photoDisplayName, withDownload } from "../../lib/photo-name";
import { PhotoGallery } from "~/components/media-studio/PhotoGallery";

interface SideRailProps {
  activeItem?: { id: string; label: string; type?: string } | null;
  activeResult?: Record<string, unknown> | null;
  ratingLevels?: Array<{ id: string; name?: string; label?: string; abbreviation?: string; color?: string }>;
  getRatingColor?: (id: string) => string;
  getRatingLabel?: (id: string) => string;
  inspectionId?: string;
  photoCount?: number;
  onGallerySetCover?: (photo: { key: string; url: string }) => void;
  onGalleryAnnotate?: (photo: { key: string; url: string }) => void;
}

type TabId = "preview" | "library" | "photos";

const TABS: Array<{ id: TabId; label: string; icon: string }> = [
  { id: "preview", label: "Preview", icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" },
  { id: "library", label: "Library", icon: "M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" },
  { id: "photos", label: "Photos", icon: "M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14M4 6h16a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V8a2 2 0 012-2z" },
];

export function SideRail({ activeItem, activeResult, getRatingColor, getRatingLabel, inspectionId, photoCount, onGallerySetCover, onGalleryAnnotate }: SideRailProps) {
  const [activeTab, setActiveTab] = useState<TabId>("preview");
  const [open, setOpen] = useState(false);

  const toggle = (tabId: TabId) => {
    if (activeTab === tabId && open) {
      setOpen(false);
    } else {
      setActiveTab(tabId);
      setOpen(true);
    }
  };

  return (
    <div className="flex h-full">
      {/* Content panel (256px, left of tab strip) */}
      {open && (
        <div className="w-64 border-l border-ih-border bg-ih-bg-card flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-ih-border">
            <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-ih-fg-4 capitalize">{activeTab}</span>
            <button onClick={() => setOpen(false)} className="w-6 h-6 flex items-center justify-center rounded text-ih-fg-4 hover:text-ih-fg-2">&#x2715;</button>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {activeTab === "preview" && (
              activeItem && activeResult ? (
                <div className="space-y-3">
                  <h4 className="text-[13px] font-bold text-ih-fg-1">{activeItem.label}</h4>

                  {Boolean(activeResult.rating) && (
                    <div>
                      <span
                        className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold text-white"
                        style={{ backgroundColor: getRatingColor?.(activeResult.rating as string) || '#6b7280' }}
                      >
                        {getRatingLabel?.(activeResult.rating as string) || (activeResult.rating as string)}
                      </span>
                    </div>
                  )}

                  {Boolean(activeResult.notes) && (
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-ih-fg-4">Notes</span>
                      <p className="text-[12px] text-ih-fg-2 mt-1 whitespace-pre-wrap leading-relaxed">{activeResult.notes as string}</p>
                    </div>
                  )}

                  {/* Canned comments */}
                  {Array.isArray(activeResult.tabs) && (() => {
                    const included = (activeResult.tabs as Array<{ name?: string; comments?: Array<Record<string, unknown>> }>)
                      .flatMap(tab => (tab.comments || [])
                        .filter(c => c.included)
                        .map(c => ({ ...c, tabName: tab.name } as Record<string, unknown> & { tabName: string | undefined })));
                    // Item attribute values (brand, year, etc.) feed Mustache tokens
                    // alongside the defect-level fields below.
                    const attrVars: Record<string, string | null> = {};
                    const attrs = activeResult.attributes;
                    if (attrs && typeof attrs === "object") {
                      for (const [k, v] of Object.entries(attrs as Record<string, unknown>)) {
                        if (v === null || v === undefined) attrVars[k] = null;
                        else if (typeof v === "string") attrVars[k] = v.length > 0 ? v : null;
                        else if (typeof v === "number" && Number.isFinite(v)) attrVars[k] = String(v);
                        else if (typeof v === "boolean") attrVars[k] = v ? "yes" : "no";
                        else attrVars[k] = null;
                      }
                    }
                    return included.length > 0 ? (
                      <div>
                        <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-ih-fg-4">Comments</span>
                        <ul className="mt-1 space-y-1">
                          {included.map((c, i) => {
                            const isDefect = c.tabName === "defects";
                            const text = (c.text as string) || "";
                            const rendered = isDefect ? renderTemplate(text, {
                              location:  (c.location  as string | null | undefined) ?? null,
                              trade:     (c.trade     as string | undefined) ? DEFECT_TRADE_LABELS[c.trade as keyof typeof DEFECT_TRADE_LABELS]         : null,
                              deadline:  (c.deadline  as string | undefined) ? DEFECT_DEADLINE_LABELS[c.deadline as keyof typeof DEFECT_DEADLINE_LABELS] : null,
                              timeframe: (c.timeframe as string | undefined) ? DEFECT_TIMEFRAME_LABELS[c.timeframe as keyof typeof DEFECT_TIMEFRAME_LABELS] : null,
                              ...attrVars,
                            }) : text;
                            return (
                              <li key={i} className="text-[11px] text-ih-fg-2 pl-2 border-l-2 border-ih-border">{rendered}</li>
                            );
                          })}
                        </ul>
                      </div>
                    ) : null;
                  })()}

                  {/* Photos */}
                  {Array.isArray(activeResult.photos) && (activeResult.photos as string[]).length > 0 && (
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-ih-fg-4">Photos</span>
                      <div className="mt-1 grid grid-cols-3 gap-1">
                        {(activeResult.photos as string[]).map((key, i) => {
                          const url = `/api/inspections/${inspectionId}/photo?key=${encodeURIComponent(key)}`;
                          const name = photoDisplayName(key);
                          return (
                            <a
                              key={i}
                              href={withDownload(url)}
                              download={name}
                              title={`Download ${name}`}
                              className="block"
                            >
                              <img
                                src={url}
                                alt={name}
                                className="w-full aspect-square object-cover rounded border border-ih-border"
                              />
                            </a>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-[13px] text-ih-fg-3 text-center py-8">Select an item to see a live preview.</p>
              )
            )}
            {activeTab === "library" && (
              <div>
                <input type="text" placeholder="Search comments..." className="w-full px-2 py-1.5 rounded border border-ih-border bg-ih-bg-app text-[12px] mb-2" />
                <p className="text-[13px] text-ih-fg-3 text-center py-8">Type <kbd className="px-1 py-0.5 bg-ih-bg-muted rounded text-[10px] font-mono border">/</kbd> in the note field to search.</p>
              </div>
            )}
            {activeTab === "photos" && (
              inspectionId ? (
                <PhotoGallery inspectionId={inspectionId} onSetCover={(p) => onGallerySetCover?.(p)} onAnnotate={(p) => onGalleryAnnotate?.(p)} />
              ) : (
                <p className="text-[13px] text-ih-fg-3 text-center py-8">Open an inspection to browse photos.</p>
              )
            )}
          </div>
        </div>
      )}

      {/* 44px vertical tab strip */}
      <div className="w-11 flex-shrink-0 bg-ih-bg-app/50 border-l border-ih-border flex flex-col items-center py-2 gap-1">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => toggle(tab.id)}
            className={`relative w-10 flex flex-col items-center gap-0.5 py-2.5 rounded-r-md transition-all ${
              activeTab === tab.id && open
                ? "bg-ih-bg-card text-ih-primary shadow-ih-card border-l-2 border-ih-primary -ml-px"
                : "text-ih-fg-4 hover:text-ih-fg-2"
            }`}
            title={tab.label}
          >
            {tab.id === "photos" && (photoCount ?? 0) > 0 && (
              <span className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-ih-primary text-white text-[9px] font-bold leading-none">
                {photoCount}
              </span>
            )}
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d={tab.icon} />
            </svg>
            <span className="text-[8px] font-bold uppercase tracking-[0.1em]" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}>{tab.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
