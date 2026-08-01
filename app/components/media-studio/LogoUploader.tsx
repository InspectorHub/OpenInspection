import { useRef } from "react";
import { m } from "~/paraglide/messages";
export interface LogoUploaderProps {
  currentUrl: string | null;
  uploading: boolean;
  onSelect: (file: File) => void;
  /**
   * `compact` is for a narrow column — the credential rows, where one of these
   * sits beside the label and member-number fields.
   *
   * The default layout is a WIDE row: a 112px preview plus a text column, with
   * 20px of padding. Dropped into the ~144px credential cell that needs 152px
   * before the caption gets a pixel, so the preview collapsed to a sliver and
   * the button and caption sat off-centre beside it. A second size is the fix;
   * a second component would drift.
   */
  size?: "default" | "compact";
}
/** Media Studio — company logo uploader. Logos keep their original format
 *  (transparent PNG / SVG): NO crop, NO bake. Just upload + fit preview. */
export function LogoUploader({ currentUrl, uploading, onSelect, size = "default" }: LogoUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const compact = size === "compact";
  return (
    <div className={`flex items-center bg-ih-bg-muted rounded-md border border-dashed border-ih-border hover:border-ih-primary transition-colors ${
      compact ? "flex-col gap-2 p-3" : "flex-col sm:flex-row gap-5 p-5"
    }`}>
      <div className={`bg-ih-bg-card rounded-md border border-ih-border flex items-center justify-center overflow-hidden ${
        compact ? "w-16 h-16" : "w-28 h-28"
      }`}>
        {currentUrl ? (
          <img src={currentUrl} className="w-full h-full object-contain p-3" alt={m.media_logo_alt()} />
        ) : (
          <div className="text-ih-fg-4">
            <svg className={compact ? "w-6 h-6" : "w-10 h-10"} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
          </div>
        )}
      </div>
      <div className={compact ? "space-y-1.5 text-center" : "space-y-2 flex-1 text-center sm:text-left"}>
        <input ref={inputRef} type="file" accept="image/png,image/svg+xml,image/jpeg,image/webp" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onSelect(f); e.target.value = ""; }} />
        <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading}
          className="h-9 px-3 rounded-md border border-ih-border text-ih-fg-2 text-[12px] font-bold hover:border-ih-primary hover:text-ih-primary transition-colors disabled:opacity-50">
          {uploading ? m.media_logo_uploading() : m.media_logo_upload()}
        </button>
        {/* The caption is a whole-line hint at full size; in the narrow cell it
            would wrap to four lines and read as broken layout, so it drops the
            letter-spacing and the shouting. */}
        <p className={compact
          ? "text-[10px] text-ih-fg-3 leading-tight"
          : "text-[11px] text-ih-fg-3 font-bold uppercase tracking-widest"}>{m.media_logo_hint()}</p>
      </div>
    </div>
  );
}
