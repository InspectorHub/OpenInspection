import { m } from "~/paraglide/messages";

/* ------------------------------------------------------------------ */
/* Tool palette (ported from editor/PhotoStudio.tsx)                   */
/* ------------------------------------------------------------------ */

export const TOOLS = [
  { id: "pan", icon: "M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" },
  { id: "circle", icon: "M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
  { id: "arrow", icon: "M4.5 19.5l15-15m0 0H8.25m11.25 0v11.25" },
  { id: "free", icon: "M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42" },
  { id: "text", icon: "M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 011.037-.443 48.282 48.282 0 005.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" },
  { id: "measure", icon: "M3 3h18M3 3v18M3 3l18 18M3 9h6M3 15h3M9 3v6M15 3v3" },
] as const;

export type ToolId = (typeof TOOLS)[number]["id"];

/* Tool labels resolve at render time (per-locale), so they must NOT be baked
 * into the module-const TOOLS array (that would freeze them at import time). */
function toolLabel(id: ToolId): string {
  switch (id) {
    case "pan": return m.media_annotate_tool_pan();
    case "circle": return m.media_annotate_tool_circle();
    case "arrow": return m.media_annotate_tool_arrow();
    case "free": return m.media_annotate_tool_free();
    case "text": return m.media_annotate_tool_text();
    case "measure": return m.media_annotate_tool_measure();
  }
}

interface AnnotationToolbarProps {
  tool: ToolId;
  caption: string;
  onSelectTool: (id: ToolId) => void;
  onCaptionChange: (caption: string) => void;
}

/* ------------------------------------------------------------------ */
/* Bottom tool palette                                                 */
/* ------------------------------------------------------------------ */

export function AnnotationToolbar({ tool, caption, onSelectTool, onCaptionChange }: AnnotationToolbarProps) {
  return (
    /* ds-allow: fixed-dark photo-studio chrome (white/* neutrals stay dark in both themes) */
    <div
      className="flex items-center gap-3 px-4 h-14 flex-shrink-0"
      style={{ background: "rgba(15,23,42,0.85)", borderTop: "1px solid rgba(255,255,255,0.08)" }}
    >
      <div className="flex items-center gap-1">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            onClick={() => onSelectTool(t.id)}
            className={`h-9 px-3 rounded-md text-[11px] font-bold flex items-center gap-1.5 transition-colors ${
              tool === t.id ? "bg-ih-primary text-white" : "text-white/60 hover:bg-white/10 hover:text-white/80"
            }`}
            title={toolLabel(t.id)}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={t.icon} />
            </svg>
            <span className="hidden sm:inline">{toolLabel(t.id)}</span>
          </button>
        ))}
      </div>

      <div className="w-px h-6 bg-white/10" />

      <div className="flex-1 min-w-0">
        <input
          type="text"
          value={caption}
          onChange={(e) => onCaptionChange(e.target.value)}
          placeholder={m.media_annotate_caption_placeholder()}
          className="w-full h-8 px-3 rounded-md bg-white/5 border border-white/10 text-white text-[12px] placeholder-white/30 outline-none focus:border-ih-primary transition-colors"
        />
      </div>
    </div>
  );
}
