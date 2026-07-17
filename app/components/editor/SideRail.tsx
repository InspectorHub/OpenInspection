import { useState, useEffect } from "react";
import { IconButton, Icon } from "@core/shared-ui";
import { renderTemplate } from "../../lib/mustache";
import { DEFECT_TRADE_LABELS, DEFECT_DEADLINE_LABELS, DEFECT_TIMEFRAME_LABELS } from "../../lib/defect-fields";
import { photoDisplayName, withDownload } from "../../lib/photo-name";
import { PhotoGallery } from "~/components/media-studio/PhotoGallery";
import { CommentLibraryList } from "./CommentLibraryList";
import { CannedCommentRow } from "../editor-shared/CannedCommentRow";
import type { EditorMode } from "../editor-shared/editor-mode";
import { m } from "~/paraglide/messages";

interface SideRailProps {
  mode: EditorMode;
  activeItem?: { id: string; label: string; type?: string } | null;
  activeResult?: Record<string, unknown> | null;
  ratingLevels?: Array<{ id: string; name?: string; label?: string; abbreviation?: string; color?: string }>;
  getRatingColor?: (id: string) => string;
  getRatingLabel?: (id: string) => string;
  inspectionId?: string;
  photoCount?: number;
  onGallerySetCover?: (photo: { key: string; url: string }) => void;
  onGalleryAnnotate?: (photo: { key: string; url: string }) => void;
  serverComments?: Array<{ id: string; text: string; useCount?: number; lastUsedAt?: number | null }>;
  librarySort?: string;
  onLibrarySearch?: (q: string) => void;
  onLibraryInsert?: (text: string, id: string) => void;
  onLibraryTabChange?: (open: boolean) => void;
  /** Initial open state — used only in server-rendered tests (defaults false). */
  initialOpen?: boolean;
  /** Authoring unification Plan-4 module K — tenant defect_categories color
   *  lookup (keyed by name AND id), forwarded to the preview tab's
   *  CannedCommentRow chip so a configured color renders here too. */
  categoryColor?: Map<string, string>;
}

type TabId = "preview" | "library" | "photos";

const TABS: Array<{ id: TabId; label: () => string; icon: string }> = [
  { id: "preview", label: () => m.editor_siderail_tab_preview(), icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" },
  { id: "library", label: () => m.editor_siderail_tab_library(), icon: "M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" },
  { id: "photos", label: () => m.editor_siderail_tab_photos(), icon: "M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14M4 6h16a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V8a2 2 0 012-2z" },
];

export function SideRail({ mode, activeItem, activeResult, getRatingColor, getRatingLabel, inspectionId, photoCount, onGallerySetCover, onGalleryAnnotate, serverComments, librarySort, onLibrarySearch, onLibraryInsert, onLibraryTabChange, initialOpen, categoryColor }: SideRailProps) {
  const [activeTab, setActiveTab] = useState<TabId>("preview");
  const [open, setOpen] = useState(initialOpen ?? false);
  // Photos: fill-only (Plan 1). Library: rich-only in fill mode — the canned
  // library is meaningless for a data-entry item (module E). In author mode
  // Library always stays (template canned authoring).
  const hideLibrary = mode === "fill" && !!activeItem && activeItem.type !== "rich";
  const visibleTabs = TABS.filter((t) => {
    if (t.id === "photos" && mode !== "fill") return false;
    if (t.id === "library" && hideLibrary) return false;
    return true;
  });
  const effectiveTab = visibleTabs.some((t) => t.id === activeTab) ? activeTab : "preview";

  // If the active item switches to non-rich while the Library tab is selected,
  // the Library tab vanishes from the strip — reset the selection to preview and
  // tell the parent the library panel closed, so its comment-fetch state (gated
  // on onLibraryTabChange) doesn't leak "open" for an item that has no library.
  useEffect(() => {
    if (hideLibrary && activeTab === "library") {
      setActiveTab("preview");
      onLibraryTabChange?.(false);
    }
  }, [hideLibrary, activeTab, onLibraryTabChange]);

  const toggle = (tabId: TabId) => {
    if (activeTab === tabId && open) {
      setOpen(false);
      if (tabId === "library") onLibraryTabChange?.(false);
    } else {
      if (open && activeTab === "library" && tabId !== "library") {
        onLibraryTabChange?.(false);
      }
      setActiveTab(tabId);
      setOpen(true);
      if (tabId === "library") onLibraryTabChange?.(true);
    }
  };

  const closePanel = () => {
    if (activeTab === "library") onLibraryTabChange?.(false);
    setOpen(false);
  };

  return (
    <div className="flex h-full">
      {/* Content panel (256px, left of tab strip) */}
      {open && (
        <div className="w-64 border-l border-ih-border bg-ih-bg-card flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-ih-border">
            <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-ih-fg-4 capitalize">{effectiveTab}</span>
            <IconButton onClick={closePanel} aria-label={m.editor_siderail_close_panel()} size="sm" className="w-6 h-6 text-ih-fg-4 hover:text-ih-fg-2">
              <Icon name="x" size={14} />
            </IconButton>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {effectiveTab === "preview" && (
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
                      <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-ih-fg-4">{m.editor_siderail_notes()}</span>
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
                        <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-ih-fg-4">{m.editor_siderail_comments()}</span>
                        <div className="mt-1 space-y-1">
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
                              <CannedCommentRow
                                key={i}
                                as="div"
                                interactive={false}
                                selected={false}
                                title={(c.title as string | undefined) ?? undefined}
                                category={isDefect ? (c.category as string | undefined) : undefined}
                                categoryColor={isDefect ? categoryColor?.get((c.category as string | undefined) ?? "") : undefined}
                                bodySlot={<p className="text-[11px] leading-relaxed text-ih-fg-2">{rendered}</p>}
                              />
                            );
                          })}
                        </div>
                      </div>
                    ) : null;
                  })()}

                  {/* Photos */}
                  {Array.isArray(activeResult.photos) && (activeResult.photos as string[]).length > 0 && (
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-ih-fg-4">{m.editor_siderail_tab_photos()}</span>
                      <div className="mt-1 grid grid-cols-3 gap-1">
                        {(activeResult.photos as string[]).map((key, i) => {
                          const url = `/api/inspections/${inspectionId}/photo?key=${encodeURIComponent(key)}`;
                          const name = photoDisplayName(key);
                          return (
                            <a
                              key={i}
                              href={withDownload(url)}
                              download={name}
                              title={m.editor_siderail_download_title({ name })}
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
                <p className="text-[13px] text-ih-fg-3 text-center py-8">{m.editor_siderail_preview_empty()}</p>
              )
            )}
            {effectiveTab === "library" && (
              <div>
                <input
                  type="text"
                  placeholder={m.editor_siderail_search_placeholder()}
                  onChange={(e) => onLibrarySearch?.(e.target.value)}
                  className="w-full px-2 py-1.5 rounded border border-ih-border bg-ih-bg-app text-[12px] mb-2"
                />
                {activeItem && (
                  <p className="text-[10px] text-ih-fg-4 mb-1.5">{m.editor_siderail_filtered_to({ label: activeItem.label })}</p>
                )}
                <CommentLibraryList
                  serverComments={serverComments ?? []}
                  selectedIndex={-1}
                  sort={librarySort ?? "relevance"}
                  onInsertText={(text, id) => onLibraryInsert?.(text, id)}
                />
              </div>
            )}
            {effectiveTab === "photos" && (
              inspectionId ? (
                <PhotoGallery inspectionId={inspectionId} onSetCover={(p) => onGallerySetCover?.(p)} onAnnotate={(p) => onGalleryAnnotate?.(p)} />
              ) : (
                <p className="text-[13px] text-ih-fg-3 text-center py-8">{m.editor_siderail_photos_empty()}</p>
              )
            )}
          </div>
        </div>
      )}

      {/* 44px vertical tab strip */}
      <div className="w-11 flex-shrink-0 bg-ih-bg-app/50 border-l border-ih-border flex flex-col items-center py-2 gap-1">
        {visibleTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => toggle(tab.id)}
            className={`relative w-10 flex flex-col items-center gap-0.5 py-2.5 rounded-r-md transition-all ${
              effectiveTab === tab.id && open
                ? "bg-ih-bg-card text-ih-primary shadow-ih-card border-l-2 border-ih-primary -ml-px"
                : "text-ih-fg-4 hover:text-ih-fg-2"
            }`}
            title={tab.label()}
          >
            {tab.id === "photos" && (photoCount ?? 0) > 0 && (
              <span className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-ih-primary text-white text-[9px] font-bold leading-none">
                {photoCount}
              </span>
            )}
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d={tab.icon} />
            </svg>
            <span className="text-[8px] font-bold uppercase tracking-[0.1em]" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}>{tab.label()}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
