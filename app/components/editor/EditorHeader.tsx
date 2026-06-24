import type { useInspectionState } from "~/hooks/useInspection";
import type { ColorScheme } from "~/lib/ui-prefs";
import { ProgressStripText } from "~/components/editor/ProgressStripText";

type EditorState = ReturnType<typeof useInspectionState>;

export interface EditorHeaderProps {
 /** Consolidated inspection state (useInspectionState return). */
 state: EditorState;
 /** Current theme scheme from useTheme(). */
 scheme: ColorScheme;
 /** Theme setter from useTheme(). */
 setColorScheme: (scheme: ColorScheme) => void;
 /** Auto-sign-on-publish toggle value. */
 autoSign: boolean;
 /** Handler for the auto-sign checkbox. */
 handleAutoSignToggle: (checked: boolean) => void;
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
}

export function EditorHeader({
 state,
 scheme,
 setColorScheme,
 autoSign,
 handleAutoSignToggle,
 tenantSlug,
 setSignModalOpen,
 handlePublishClick,
 collabEditing,
 onOpenVersionHistory,
}: EditorHeaderProps) {
 return (
 <div className="fixed top-0 left-0 right-0 z-50">
 <div className="h-14 bg-ih-bg-card border-b border-ih-border flex items-center px-4 gap-3">
 <a
 href="/dashboard"
 className="w-9 h-9 rounded-md flex items-center justify-center text-ih-fg-3 hover:bg-ih-bg-muted"
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
 <div className="flex-1 min-w-0">
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

 {/* Search */}
 <div className="hidden lg:flex items-center">
 <input
 type="text"
 placeholder="Search report..."
 value={state.searchQuery}
 onChange={(e) => state.setSearchQuery(e.target.value)}
 className="w-44 h-8 px-3 rounded-md border border-ih-border bg-ih-bg-app text-[12px]"
 />
 </div>

 {/* View mode */}
 <div className="hidden lg:flex items-center gap-0.5 bg-ih-bg-muted rounded-md p-0.5">
 <button
 onClick={() => state.setViewMode("split")}
 className={`px-2 py-1 rounded text-[11px] font-bold ${state.viewMode === "split" ? "bg-ih-bg-card text-ih-fg-1 shadow-ih-card" : "text-ih-fg-3"}`}
 title="Split view (Cmd+1)"
 >Split</button>
 <button
 onClick={() => state.setViewMode("focus")}
 className={`px-2 py-1 rounded text-[11px] font-bold ${state.viewMode === "focus" ? "bg-ih-bg-card text-ih-fg-1 shadow-ih-card" : "text-ih-fg-3"}`}
 title="Focus view (Cmd+2)"
 >Focus</button>
 </div>

 {/* Batch mode toggle */}
 <button
 onClick={() => {
  if (state.batchMode) {
  state.setBatchMode(false);
  state.setBatchSelected({});
  } else {
  state.setBatchMode(true);
  }
 }}
 className={`hidden lg:flex w-9 h-9 rounded-md items-center justify-center ${
  state.batchMode
  ? "bg-ih-primary-tint text-ih-primary"
  : "text-ih-fg-3 hover:bg-ih-bg-muted"
 }`}
 title={state.batchMode ? "Exit batch mode" : "Batch mode (B)"}
 >
 <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
 </svg>
 </button>

 {/* #181 — Version history (only when collab editing is enabled) */}
 {collabEditing && (
 <button
 onClick={() => onOpenVersionHistory?.()}
 className="hidden lg:flex w-9 h-9 rounded-md items-center justify-center text-ih-fg-3 hover:bg-ih-bg-muted"
 title="Version history"
 >
 <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
 </svg>
 </button>
 )}

 {/* Completion progress */}
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

 {/* Theme cycle: light → dark → field (Track H 迁移⑤) → auto */}
 <button
 onClick={() => setColorScheme(scheme === 'light' ? 'dark' : scheme === 'dark' ? 'field' : scheme === 'field' ? 'auto' : 'light')}
 className="w-9 h-9 rounded-md flex items-center justify-center text-ih-fg-3 hover:bg-ih-bg-muted"
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
 </button>

 {/* Settings button */}
 <button
 onClick={() => state.setSettingsOpen(true)}
 className="w-9 h-9 rounded-md flex items-center justify-center text-ih-fg-3 hover:bg-ih-bg-muted"
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
 </button>

 {/* Auto-sign toggle */}
 <label className="hidden lg:inline-flex items-center gap-1.5 text-[11px] font-medium text-ih-fg-3 cursor-pointer select-none">
 <input
 type="checkbox"
 checked={autoSign}
 onChange={(e) => handleAutoSignToggle(e.target.checked)}
 className="h-3.5 w-3.5 rounded border-ih-border-strong text-ih-primary"
 />
 Auto-sign
 </label>

 {/* Preview full report — opens the whole report (all sections) in a new tab.
     Owner preview works on drafts (tokenless via the report-view loader). */}
 {tenantSlug && (
 <button
 onClick={() => window.open(`/report-view/${tenantSlug}/${state.inspection.id}`, "_blank", "noopener")}
 className="hidden lg:inline-flex h-9 px-3 rounded-md border border-ih-border text-[12px] font-bold text-ih-fg-2 hover:bg-ih-bg-muted items-center gap-1.5"
 title="Preview the full report (all sections) in a new tab"
 >
 <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
 </svg>
 Preview
 </button>
 )}

 {/* Preview PDF — opens the real server-rendered PDF deliverable (the exact
     client deliverable) in a new tab. Owner on-demand render works pre-publish
     on drafts via the owner/JWT-authed /api/inspections/:id/pdf endpoint. */}
 <button
 onClick={() => window.open(`/api/inspections/${state.inspection.id}/pdf?type=full`, "_blank", "noopener")}
 className="hidden lg:inline-flex h-9 px-3 rounded-md border border-ih-border text-[12px] font-bold text-ih-fg-2 hover:bg-ih-bg-muted items-center gap-1.5"
 title="Preview the real server-rendered PDF (the exact client deliverable) in a new tab"
 >
 <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
 </svg>
 Preview PDF
 </button>

 {/* Sign now button */}
 <button
 onClick={() => setSignModalOpen(true)}
 className="hidden lg:inline-flex h-9 px-3 rounded-md border border-ih-border text-[12px] font-bold text-ih-fg-2 hover:bg-ih-bg-muted items-center gap-1.5"
 title="Sign this inspection now"
 >
 <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
 </svg>
 Sign now
 </button>

 {/* Publish button */}
 <button
 onClick={handlePublishClick}
 className="h-9 px-4 rounded-md bg-ih-ok text-white font-bold text-[12px] hover:bg-ih-ok/85 transition-colors inline-flex items-center gap-1.5"
 >
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
 Publish
 </button>
 </div>
 </div>
 );
}
