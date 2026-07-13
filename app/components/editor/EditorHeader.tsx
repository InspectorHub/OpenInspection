import type { ReactNode } from "react";
import type { useInspectionState } from "~/hooks/useInspection";
import { Button, IconButton, Icon } from "@core/shared-ui";
import { usePdfExport, pdfActionLabel } from "~/hooks/usePdfExport";
import type { ColorScheme } from "~/lib/ui-prefs";
import { ProgressStripText } from "~/components/editor/ProgressStripText";
import { TemplateMenu } from "~/components/editor/TemplateMenu";

type EditorState = ReturnType<typeof useInspectionState>;

export interface EditorHeaderProps {
 /** Consolidated inspection state (useInspectionState return). */
 state: EditorState;
 /** Current theme scheme from useTheme(). */
 scheme: ColorScheme;
 /** Theme setter from useTheme(). */
 setColorScheme: (scheme: ColorScheme) => void;
 /** Tenant slug (for the full-report preview link); may be null/undefined. */
 tenantSlug?: string | null;
 /** Opens the manual sign modal. */
 setSignModalOpen: (open: boolean) => void;
 /** Publish button click handler. */
 handlePublishClick: () => void;
 /** #181 — whether collab (and thus version history) is available. */
 collabEditing?: boolean;
 /** Opens the version-history panel. */
 onOpenVersionHistory?: () => void;
 /**
  * Commercial PCA Phase U (Batch C2b) — per-unit controls (scope switcher +
  * per-unit progress + the Units-manager button). Rendered in the left zone
  * only when provided; residential / tagged-mode editors pass nothing and the
  * header renders byte-identically to before.
  */
 perUnitControls?: ReactNode;
 /** Template menu (config cluster) — open the template picker to swap templates. */
 onChangeTemplate: () => void;
 /** Template menu — save the current structure as a new template. */
 onSaveAsNewTemplate: () => void;
 /** Template menu — write the current structure back to the source template. */
 onUpdateSourceTemplate: () => void;
 /** Whether the inspection has a source template (enables "Update source"). */
 canUpdateSourceTemplate: boolean;
}

export function EditorHeader({
 state,
 scheme,
 setColorScheme,
 tenantSlug,
 setSignModalOpen,
 handlePublishClick,
 collabEditing,
 onOpenVersionHistory,
 perUnitControls,
 onChangeTemplate,
 onSaveAsNewTemplate,
 onUpdateSourceTemplate,
 canUpdateSourceTemplate,
}: EditorHeaderProps) {
 // Shared Browser Rendering rate-limit UX for the on-demand PDF preview.
 const pdf = usePdfExport();
 return (
 // z-40 (below the z-50 overlay layer): this fixed header is page chrome, so
 // modals and right-side Drawers (both z-50) must paint OVER it. At an equal
 // z-50 the header's top-right Publish button geometrically overlapped a
 // Drawer's top-right Close ✕ and — winning the paint-order tie — stole its
 // clicks. Keeping the header a layer below the overlays fixes that for every
 // drawer/modal without per-dialog z bumps.
 <div className="fixed top-0 left-0 right-0 z-40">
 <div className="h-14 bg-ih-bg-card border-b border-ih-border flex items-center px-4 gap-3">

 {/* Left zone: navigation + identity + progress + save status + status badge */}
 <div className="flex items-center gap-3 min-w-0 flex-1">
 <a
  href="/inspections"
  className="w-9 h-9 shrink-0 rounded-md flex items-center justify-center text-ih-fg-3 hover:bg-ih-bg-muted"
 >
  <svg
  className="w-4 h-4"
  fill="none"
  stroke="currentColor"
  viewBox="0 0 24 24"
  >
  <path
   strokeLinecap="round"
   strokeLinejoin="round"
   strokeWidth={2}
   d="M19 12H5M12 19l-7-7 7-7"
  />
  </svg>
 </a>
 <div className="min-w-0">
  <div className="text-[14px] font-bold truncate">
  {(state.inspection.propertyAddress as string) || "Inspection"}
  </div>
  <div className="text-[11px] text-ih-fg-3 truncate">
  #{String(state.inspection.id).slice(0, 8).toUpperCase()}
  {state.formattedDate && (
   <span className="ml-2">{state.formattedDate}</span>
  )}
  </div>
 </div>

 {/* Completion progress [INFORMATION] — the least critical info; drops out
     first on narrow widths so identity + status stay legible. */}
 <div className="hidden 2xl:flex items-center">
 {(() => {
  const stats = state.overallStats();
  return (
  <ProgressStripText
   rated={stats.rated}
   total={stats.total}
   defects={stats.defect}
   monitor={stats.monitor}
   etaMinutes={stats.etaMinutes}
  />
  );
 })()}
 </div>

 {/* Save status indicator */}
 {state.saveStatus !== "idle" && (
  <span
  className={`inline-flex items-center gap-1.5 text-[11px] font-bold ${
   state.saveStatus === "saving"
   ? "text-ih-watch"
   : state.saveStatus === "saved"
   ? "text-ih-ok"
   : "text-ih-bad"
  }`}
  >
  {state.saveStatus === "saving" ? (
   <>
   <span className="w-1.5 h-1.5 rounded-full bg-ih-watch animate-pulse" />
   Saving...
   </>
  ) : state.saveStatus === "saved" ? (
   <>
   <svg
    className="w-3.5 h-3.5"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
   >
    <path
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth={2}
    d="M5 13l4 4L19 7"
    />
   </svg>
   Saved
   </>
  ) : (
   <>
   <span className="w-1.5 h-1.5 rounded-full bg-ih-bad" />
   Error
   </>
  )}
  </span>
 )}

 {/* Status badge */}
 <span className="px-2 h-7 rounded-md text-[11px] font-bold uppercase tracking-wide ring-1 ring-inset bg-ih-bg-muted text-ih-fg-2 ring-ih-border inline-flex items-center">
  {state.inspection.status as string}
 </span>

 </div>

 {/* SCOPE zone [per-unit only] — the "which unit am I editing" cluster
     (scope breadcrumb + unit progress + Units manager). Its own group, set
     apart from both identity (left) and actions (right). Nothing renders here
     for residential / tagged-mode editors. */}
 {perUnitControls && (
 <div className="flex items-center shrink-0 border-l border-ih-border pl-3">
 {perUnitControls}
 </div>
 )}

 {/* Center zone: report search + version history [tools] */}
 <div className="hidden xl:flex items-center gap-2">
 {/* Search */}
 <input
  type="text"
  placeholder="Search report..."
  value={state.searchQuery}
  onChange={(e) => state.setSearchQuery(e.target.value)}
  className="w-44 h-8 px-3 rounded-md border border-ih-border bg-ih-bg-app text-[12px]"
 />

 {/* Item fullscreen + batch mode moved OUT of the header — object-scoped
     actions live with their object (fullscreen → item editor pane; batch →
     item list column). The header holds global actions only. */}

 {/* #181 — Version history (only when collab editing is enabled) */}
 {collabEditing && (
  <IconButton
  aria-label="Version history"
  onClick={() => onOpenVersionHistory?.()}
  title="Version history"
  >
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
  </IconButton>
 )}
 </div>

 {/* Right zone: theme + settings + preview + preview PDF + sign now + publish */}
 <div className="flex items-center gap-2">
 {/* Theme cycle: light → dark → field → auto */}
 <IconButton
  aria-label={`Theme: ${scheme}${scheme === 'field' ? ' (high-contrast outdoor)' : ''}`}
  onClick={() => setColorScheme(scheme === 'light' ? 'dark' : scheme === 'dark' ? 'field' : scheme === 'field' ? 'auto' : 'light')}
  className="hidden xl:flex"
  title={`Theme: ${scheme}${scheme === 'field' ? ' (high-contrast outdoor)' : ''}`}
 >
  {scheme === 'dark' ? (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>
  ) : scheme === 'light' ? (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
  ) : scheme === 'field' ? (
  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364-.707-.707M6.343 6.343l-.707-.707m12.728 0-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></svg>
  ) : (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
  )}
 </IconButton>

 {/* Settings button */}
 <IconButton
  aria-label="Inspection settings"
  onClick={() => state.setSettingsOpen(true)}
  title="Inspection settings"
 >
  <svg
  className="w-4 h-4"
  fill="none"
  stroke="currentColor"
  viewBox="0 0 24 24"
  >
  <path
   strokeLinecap="round"
   strokeLinejoin="round"
   strokeWidth={2}
   d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
  />
  <path
   strokeLinecap="round"
   strokeLinejoin="round"
   strokeWidth={2}
   d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
  />
  </svg>
 </IconButton>

 {/* Template menu [config] — global template actions consolidated here
     (swap template · save as new · update source), replacing the buttons
     that used to sit at the section-rail bottom. */}
 <TemplateMenu
  onChangeTemplate={onChangeTemplate}
  onSaveAsNewTemplate={onSaveAsNewTemplate}
  onUpdateSourceTemplate={onUpdateSourceTemplate}
  canUpdateSource={canUpdateSourceTemplate}
 />

 {/* Preview full report — opens the whole report (all sections) in a new tab.
     Owner preview works on drafts (tokenless via the report-view loader). */}
 {tenantSlug && (
  <Button
  variant="secondary"
  size="md"
  onClick={() => window.open(`/report-view/${tenantSlug}/${state.inspection.id}`, "_blank", "noopener")}
  className="hidden 2xl:inline-flex"
  title="Preview the full report (all sections) in a new tab"
  icon={
   <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
   </svg>
  }
  >
  Preview
  </Button>
 )}

 {/* Preview PDF — opens the real server-rendered PDF deliverable (the exact
     client deliverable) in a new tab. Owner on-demand render works pre-publish
     on drafts via the owner/JWT-authed /api/inspections/:id/pdf endpoint. */}
 <Button
  variant="secondary"
  size="md"
  onClick={() => pdf.exportPdf(`/api/inspections/${state.inspection.id}/pdf?type=full`, { mode: "view", filename: `report-${state.inspection.id}.pdf` })}
  disabled={pdf.busy}
  className="hidden xl:inline-flex"
  title={pdf.error ?? "Preview the real server-rendered PDF (the exact client deliverable) in a new tab"}
  icon={
   <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
   </svg>
  }
 >
  {pdfActionLabel(pdf, "Preview PDF")}
 </Button>

 {/* Sign now button */}
 <Button
  variant="secondary"
  size="md"
  onClick={() => setSignModalOpen(true)}
  className="hidden xl:inline-flex"
  title="Sign this inspection now"
  icon={<Icon name="edit" className="w-3.5 h-3.5" />}
 >
  Sign now
 </Button>

 {/* Publish button */}
 <Button
  variant="primary"
  onClick={handlePublishClick}
  icon={
   <svg
   className="w-3.5 h-3.5"
   fill="none"
   stroke="currentColor"
   viewBox="0 0 24 24"
   >
   <path
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth={2}
    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
   />
   </svg>
  }
 >
  Publish
 </Button>
 </div>

 </div>
 </div>
 );
}
