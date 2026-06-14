import { useRef } from "react";
export interface LogoUploaderProps {
  currentUrl: string | null;
  uploading: boolean;
  onSelect: (file: File) => void;
}
/** Image Studio — company logo uploader. Logos keep their original format
 *  (transparent PNG / SVG): NO crop, NO bake. Just upload + fit preview. */
export function LogoUploader({ currentUrl, uploading, onSelect }: LogoUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col sm:flex-row items-center gap-5 p-5 bg-ih-bg-muted rounded-md border border-dashed border-ih-border hover:border-ih-primary transition-colors">
      <div className="w-28 h-28 bg-ih-bg-card rounded-md border border-ih-border flex items-center justify-center overflow-hidden">
        {currentUrl ? (
          <img src={currentUrl} className="w-full h-full object-contain p-3" alt="Logo" />
        ) : (
          <div className="text-ih-fg-4">
            <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
          </div>
        )}
      </div>
      <div className="space-y-2 flex-1 text-center sm:text-left">
        <input ref={inputRef} type="file" accept="image/png,image/svg+xml,image/jpeg,image/webp" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onSelect(f); e.target.value = ""; }} />
        <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading}
          className="h-9 px-3 rounded-md border border-ih-border text-ih-fg-2 text-[12px] font-bold hover:border-ih-primary hover:text-ih-primary transition-colors disabled:opacity-50">
          {uploading ? "Uploading…" : "Upload logo"}
        </button>
        <p className="text-[11px] text-ih-fg-3 font-bold uppercase tracking-widest">PNG / SVG recommended (transparent)</p>
      </div>
    </div>
  );
}
