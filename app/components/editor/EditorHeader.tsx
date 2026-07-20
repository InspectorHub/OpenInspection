import type { ReactNode } from "react";
import type { useInspectionState } from "~/hooks/useInspection";
import { Button, IconButton, Icon } from "@core/shared-ui";
import { usePdfExport, pdfActionLabel } from "~/hooks/usePdfExport";
import { ThemeSegmentControl } from "~/components/sidebar/ThemeSegmentControl";
import { ProgressStripText } from "~/components/editor/ProgressStripText";
import { TemplateMenu } from "~/components/editor/TemplateMenu";
import { m } from "~/paraglide/messages";

type EditorState = ReturnType<typeof useInspectionState>;

export interface EditorHeaderProps {
 /** Consolidated inspection state (useInspectionState return). */
 state: EditorState;
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
  {(state.inspection.propertyAddress as string) || m.editor_header_property_fallback()}
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
   {m.editor_header_save_saving()}
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
   {m.editor_header_save_saved()}
   </>
  ) : (
   <>
   <span className="w-1.5 h-1.5 rounded-full bg-ih-bad" />
   {m.editor_header_save_error()}
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
  placeholder={m.editor_header_search_placeholder()}
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
  aria-label={m.editor_header_version_history()}
  onClick={() => onOpenVersionHistory?.()}
  title={m.editor_header_version_history()}
  >
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
  </IconButton>
 )}
 </div>

 {/* Right zone: theme + settings + preview + preview PDF + sign now + publish */}
 <div className="flex items-center gap-2">
 {/* Theme — the shared 4-segment control (auto/light/dark/field), same as the
     tenant sidebar. Shown from xl up where the header has room; narrower
     widths reach it through the mobile Theme drawer. */}
 <ThemeSegmentControl className="hidden xl:flex" />

 {/* Settings button */}
 <IconButton
  aria-label={m.editor_header_settings()}
  onClick={() => state.setSettingsOpen(true)}
  title={m.editor_header_settings()}
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
  title={m.editor_header_preview_full_title()}
  icon={
   <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
   </svg>
  }
  >
  {m.editor_header_preview()}
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
  title={pdf.error ?? m.editor_header_preview_pdf_title()}
  icon={
   <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
   </svg>
  }
 >
  {pdfActionLabel(pdf, m.editor_header_preview_pdf())}
 </Button>

 {/* Sign now button */}
 <Button
  variant="secondary"
  size="md"
  onClick={() => setSignModalOpen(true)}
  className="hidden xl:inline-flex"
  title={m.editor_header_sign_title()}
  icon={<Icon name="edit" className="w-3.5 h-3.5" />}
 >
  {m.editor_header_sign()}
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
  {m.editor_header_publish()}
 </Button>
 </div>

 </div>
 </div>
 );
}
