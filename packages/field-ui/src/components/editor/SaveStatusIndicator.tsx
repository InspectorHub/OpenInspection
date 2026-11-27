import { m } from "../../i18n";

export type SaveStatus = "idle" | "saving" | "saved" | "saved-local" | "error";

/**
 * The save indicator: Saving, Saved, or Save failed (nothing while idle). The desktop header and the phone and
 * tablet app bars show the same one, so a failed save is never visible in only some layouts.
 *
 * #477 — "Saved" is split in two. A write that reached the local Yjs doc but
 * has not been confirmed by the server shows "Saved on this device" (amber:
 * held here, not yet synced); only the collab sync step promotes it to
 * "Saved". A write that never reached the server must never read as saved.
 */
export function SaveStatusIndicator({ status, held = false }: { status: SaveStatus; held?: boolean }) {
 // The collab connection kept a stale offline copy it could not back up and is not syncing (lineage guard): said before any save state.
 if (held) {
  return (
   <span data-testid="save-status" data-status="held" role="status" aria-live="polite" title={m.editor_header_save_held_detail()} className="inline-flex shrink-0 whitespace-nowrap items-center gap-1.5 text-[11px] font-bold text-ih-bad-fg">
    <span className="w-1.5 h-1.5 rounded-full bg-ih-bad" />
    {m.editor_header_save_held()}
   </span>
  );
 }
 if (status === "idle") return null;
 return (
  <span
  data-testid="save-status"
  data-status={status}
  role="status"
  aria-live="polite"
  className={`inline-flex shrink-0 whitespace-nowrap items-center gap-1.5 text-[11px] font-bold ${
   status === "saving" || status === "saved-local"
   ? "text-ih-watch-fg"
   : status === "saved"
   ? "text-ih-ok-fg"
   : "text-ih-bad-fg"
  }`}
  >
  {status === "saving" ? (
   <>
   <span className="w-1.5 h-1.5 rounded-full bg-ih-watch animate-pulse" />
   {m.editor_header_save_saving()}
   </>
  ) : status === "saved-local" ? (
   <>
   <span className="w-1.5 h-1.5 rounded-full bg-ih-watch" />
   {m.editor_header_save_saved_local()}
   </>
  ) : status === "saved" ? (
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
 );
}
