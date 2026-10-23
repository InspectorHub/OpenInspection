import { m } from "../../i18n";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

/**
 * The save indicator: Saving, Saved, or Save failed (nothing while idle). The desktop header and the phone and
 * tablet app bars show the same one, so a failed save is never visible in only some layouts.
 */
export function SaveStatusIndicator({ status }: { status: SaveStatus }) {
 if (status === "idle") return null;
 return (
  <span
  data-testid="save-status"
  data-status={status}
  className={`inline-flex items-center gap-1.5 text-[11px] font-bold ${
   status === "saving"
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
