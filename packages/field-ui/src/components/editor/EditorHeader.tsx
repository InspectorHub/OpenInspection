import { useState, type MouseEvent, type ReactNode } from "react";
import type { useInspectionState } from "../../hooks/useInspection";
import { Button, IconButton, Icon } from "@core/shared-ui";
import { useFieldDataSource, useFieldSlots } from "../../context";
import { useEditorCapabilities } from "../../hooks/useEditorCapabilities";
import { useHostActions } from "../../hooks/useHostActions";
import { ProgressStripText } from "./ProgressStripText";
import { TemplateMenu } from "./TemplateMenu";
import { PreviewMenu } from "./PreviewMenu";
import { SaveStatusIndicator } from "./SaveStatusIndicator";
import { HEADER_OVERFLOW } from "./header-visibility";
import { runWithPending } from "./publish-pending";
import { HeaderOverflowMenu } from "./HeaderOverflowMenu";
import { useReadOnly } from "../../read-only";
import { m } from "../../i18n";

type EditorState = ReturnType<typeof useInspectionState>;

const BACK_CLASS = "w-9 h-9 shrink-0 rounded-md flex items-center justify-center text-ih-fg-3 hover:bg-ih-bg-muted";
const backIcon = (
 <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 12H5M12 19l-7-7 7-7" />
 </svg>
);

export interface EditorHeaderProps {
 /** Consolidated inspection state (useInspectionState return). */
 state: EditorState;
 /** Tenant slug (for the full-report preview link); may be null/undefined. */
 tenantSlug?: string | null;
 /** Opens the manual sign modal. */
 setSignModalOpen: (open: boolean) => void;
 /**
  * Publish button click handler.
  *
  * Typed as returning `unknown` rather than `void` so this component can AWAIT
  * it when it returns a promise — the editor's handler runs a readiness check
  * over the network before the publish dialog opens, and that took about three
  * seconds with no spinner and no disabled state. A primary action that looks
  * like it did nothing invites a second click, on the one button in the product
  * where a second click is expensive.
  */
 handlePublishClick: () => unknown;
 /** Marks the on-site work complete (advisory order-lifecycle move). */
 handleFinishFieldwork: () => void;
 /** Whether the finish-fieldwork request is in flight. */
 finishingFieldwork: boolean;
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
 handleFinishFieldwork,
 finishingFieldwork,
 collabEditing,
 onOpenVersionHistory,
 perUnitControls,
 onChangeTemplate,
 onSaveAsNewTemplate,
 onUpdateSourceTemplate,
 canUpdateSourceTemplate,
}: EditorHeaderProps) {
 // The PDF preview and the theme switch are host UI (see `FieldHostSlots`); a host that
 // supplies none simply gets no such entry point.
 const { pdf, renderThemeControl } = useFieldSlots();
 const caps = useEditorCapabilities();
 const readOnly = useReadOnly();
 const { urls, exit } = useFieldDataSource();
 const { openPreview } = useHostActions(String(state.inspection.id));
 const listHref = urls.inspectionsList?.() ?? null;
 // A plain left click goes through `exit()` so the host's unsaved-changes guard sees it; a modified click or a
 // middle click keeps the browser's own link behaviour (new tab, new window).
 const onBackClick = (e: MouseEvent<HTMLAnchorElement>) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  exit();
 };
 const previewHref = tenantSlug ? urls.reportPreview(tenantSlug, String(state.inspection.id)) : null;
 /**
  * True while the pre-publish readiness check is in flight.
  *
  * The guard is this state and not a ref: unlike a double-submit (which has to
  * be refused inside a single render pass), the thing being prevented here is a
  * second click SECONDS later, and the same flag has to be visible on the button
  * — an invisible guard would leave the button looking just as unresponsive as
  * before, which is the actual complaint.
  */
 const [openingPublish, setOpeningPublish] = useState(false);
 function onPublishClick() {
  if (openingPublish) return;
  runWithPending(handlePublishClick, setOpeningPublish);
 }
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
 <div data-testid="header-identity" className="flex items-center gap-3 min-w-0 flex-1 overflow-hidden">
 {listHref ? (
  <a href={listHref} onClick={onBackClick} aria-label={m.common_back()} className={BACK_CLASS}>{backIcon}</a>
 ) : (
  <button type="button" onClick={exit} aria-label={m.common_back()} className={BACK_CLASS}>{backIcon}</button>
 )}
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
 <div data-testid="header-progress" className="hidden min-[2400px]:flex items-center">
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
 <SaveStatusIndicator status={state.saveStatus} />

 {/* Status badge */}
 <span data-testid="header-status" className="hidden min-[1400px]:inline-flex shrink-0 whitespace-nowrap px-2 h-7 rounded-md text-[11px] font-bold uppercase tracking-wide ring-1 ring-inset bg-ih-bg-muted text-ih-fg-2 ring-ih-border items-center">
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

 {/* Center zone: report search + version history [tools]. Both hide together
     at the same breakpoint; only version history reappears in the More menu.
     Search does not: typing into a popover is worse than not offering it, and
     an inspector on a tablet navigates by section rail, not by search. */}
 <div data-testid="header-search" className={`${HEADER_OVERFLOW.versionHistory.inline} items-center gap-2 shrink-0`}>
 {/* Search */}
 <input
  type="text"
  placeholder={m.editor_header_search_placeholder()}
  aria-label={m.editor_header_search_placeholder()}
  value={state.searchQuery}
  onChange={(e) => state.setSearchQuery(e.target.value)}
  className="w-36 h-8 px-3 rounded-md border border-ih-border bg-ih-bg-app text-[12px]"
 />

 {/* Item fullscreen + batch mode moved OUT of the header — object-scoped
     actions live with their object (fullscreen → item editor pane; batch →
     item list column). The header holds global actions only. */}

 {/* #181 — Version history (only when collab editing is enabled) */}
 {collabEditing && caps.versionHistory && !readOnly && (
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
 <div data-testid="header-actions" className="flex items-center gap-2 shrink-0 whitespace-nowrap">
 {/* Theme — the shared 4-segment control (auto/light/dark/field), same as the
     tenant sidebar. Shown from xl up where the header has room; narrower
     widths reach it through the mobile Theme drawer. */}
 {renderThemeControl?.({ className: HEADER_OVERFLOW.theme.inline })}

 {/* Report settings — a labelled button, not a bare gear.
     IA-87 ③ / IA-88 ⑤: this was the only unlabelled icon in a row of text
     buttons, and it was the sole entry point to per-inspection report
     settings, so the most important control in the header was also the
     least discoverable. The label collapses on narrow widths (where its
     text-button neighbours hide entirely) but the button itself never
     does — nothing else opens this sheet. */}
 {caps.settingsSheet && !readOnly && <Button
  variant="secondary"
  size="md"
  aria-label={m.editor_header_settings()}
  onClick={() => state.setSettingsOpen(true)}
  title={m.editor_header_settings()}
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
   d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
  />
  <path
   strokeLinecap="round"
   strokeLinejoin="round"
   strokeWidth={2}
   d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
  />
  </svg>
  }
 >
  <span className="hidden min-[1920px]:inline">{m.editor_header_settings()}</span>
 </Button>}

 {/* Template menu [config] — global template actions consolidated here
     (swap template · save as new · update source), replacing the buttons
     that used to sit at the section-rail bottom. */}
 {!readOnly && <TemplateMenu
  onChangeTemplate={caps.settingsSheet ? onChangeTemplate : null}
  onSaveAsNewTemplate={onSaveAsNewTemplate}
  onUpdateSourceTemplate={onUpdateSourceTemplate}
  canUpdateSource={canUpdateSourceTemplate}
 />}

 {/* Preview [CHECK tier] — the report's two fidelities behind one control.
     Never hides: it is the rehearsal for Publish, and Publish never hides.
     The web report is the owner preview (works on drafts, tokenless via the
     report-view loader); the PDF is the real server-rendered deliverable
     (owner on-demand pre-publish via the JWT-authed endpoint). */}
 {/* No destination at all (no tenant link or no host that opens it, and no PDF export) means no menu: an empty Preview is a dead control. */}
 {((previewHref && openPreview) || pdf) && (
  <PreviewMenu
   onPreviewReport={previewHref && openPreview ? () => openPreview(previewHref) : null}
   onPreviewPdf={pdf ? () => pdf.run(String(state.inspection.id)) : null}
   pdfBusy={pdf?.busy ?? false}
   pdfError={pdf?.error ?? null}
   /* Inside a menu already labelled "Preview", the rows name destinations,
      not actions — "Web report" / "PDF", not "Web report" / "Preview PDF".
      The busy and cooldown states replace the label outright, so the short
      form loses nothing. */
   pdfLabel={pdf ? pdf.actionLabel(m.editor_header_preview_pdf_short()) : m.editor_header_preview_pdf_short()}
  />
 )}

 {/* Sign now button */}
 {!readOnly && <Button
  variant="secondary"
  size="md"
  onClick={() => setSignModalOpen(true)}
  className={HEADER_OVERFLOW.sign.inline}
  title={m.editor_header_sign_title()}
  icon={<Icon name="edit" className="w-3.5 h-3.5" />}
 >
  {m.editor_header_sign()}
 </Button>}

 {/* Finish fieldwork — advisory order-lifecycle move, shown until the
     on-site work is marked complete. Publishing does not require it. A more
     central action than Sign (xl-only), so it appears from lg up. */}
 {!readOnly && (state.inspection.status as string) !== "completed" && (
 <Button
  variant="secondary"
  size="md"
  onClick={handleFinishFieldwork}
  pending={finishingFieldwork}
  className={HEADER_OVERFLOW.finishFieldwork.inline}
  icon={<Icon name="check" className="w-3.5 h-3.5" />}
 >
  {finishingFieldwork ? m.editor_finish_fieldwork_pending() : m.editor_finish_fieldwork()}
 </Button>
 )}

 {/* More [COMPOSE tier overflow] — holds exactly what this width dropped.
     Sits immediately left of Publish so the controls that vanished from the
     row are one tap from where they used to be. Hides itself at xl, where
     everything it holds is inline again. */}
 <HeaderOverflowMenu
  onSign={() => setSignModalOpen(true)}
  onFinishFieldwork={
   !readOnly && (state.inspection.status as string) !== "completed" ? handleFinishFieldwork : null
  }
  finishingFieldwork={finishingFieldwork}
  onOpenVersionHistory={collabEditing && caps.versionHistory && onOpenVersionHistory && !readOnly ? onOpenVersionHistory : null}
  /* Full width in the menu: at its intrinsic size the four segments sit in
     a short pill against a much wider panel, reading as a stray chip rather
     than a control. */
  themeControl={renderThemeControl?.({ className: "w-full" }) ?? null}
 />

 {/* Publish button */}
 {!readOnly && <Button
  variant="primary"
  onClick={onPublishClick}
  // pending (not disabled) keeps focus on the button; see Button. onPublishClick also refuses re-entry.
  pending={openingPublish}
  data-testid="editor-publish-btn"
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
  {openingPublish ? m.report_publish_checking() : m.editor_header_publish()}
 </Button>}
 </div>

 </div>
 </div>
 );
}
