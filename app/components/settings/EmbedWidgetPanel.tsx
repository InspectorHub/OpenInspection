import { useState } from "react";
import { useCopyClipboard } from "~/hooks/useCopyClipboard";

const STYLES = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "branded", label: "Branded" },
] as const;

export function EmbedWidgetPanel({ tenant }: { tenant: string | null | undefined }) {
  const [style, setStyle] = useState<"light" | "dark" | "branded">("light");
  const { copied, copy } = useCopyClipboard();

  // Company-level embed: only requires tenant (slug not needed).
  // See Part 4c — we use company-only embed, no per-inspector variant in the snippet.
  if (!tenant) {
    return (
      <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-3">
        <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">Embed widget</h3>
        <div className="w-full min-h-[200px] rounded-md border-2 border-dashed border-ih-border flex items-center justify-center">
          <div className="text-center">
            <EmbedIcon />
            <p className="text-[13px] text-ih-fg-3 mt-2">No company configured — embed widget unavailable.</p>
          </div>
        </div>
      </section>
    );
  }

  // SSR produces "" for origin; client produces the real origin.
  // Same pre-existing mismatch class as StatusAndLinks above.
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const embedUrl = `${origin}/embed/${tenant}?style=${style}`;
  const snippet = `<iframe src="${origin}/embed/${tenant}?style=${style}" style="width:100%;min-height:700px;border:none;" loading="lazy"></iframe>`;

  return (
    <section className="bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-4">
      <h3 className="text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">Embed widget</h3>

      <div className="flex gap-2">
        {STYLES.map((s) => (
          <button
            key={s.id}
            onClick={() => setStyle(s.id)}
            className={`h-9 px-4 rounded-md border-2 text-[13px] font-bold transition-colors ${
              style === s.id
                ? "border-ih-primary text-ih-primary bg-ih-primary-tint"
                : "border-ih-border text-ih-fg-2 hover:border-ih-border"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-bold text-ih-fg-2">Embed code</span>
          <button
            onClick={() => copy(snippet)}
            className="h-8 px-3 rounded-md bg-ih-primary text-white font-bold text-[12px] hover:bg-ih-primary-600 transition-colors"
          >
            {copied ? "Copied!" : "Copy snippet"}
          </button>
        </div>
        {/* ds-allow: fixed-dark terminal/code block — stays dark in both themes */}
        <pre className="bg-slate-900 text-emerald-300 dark:bg-slate-950 p-4 rounded-md overflow-x-auto text-[12px] font-mono leading-relaxed whitespace-pre-wrap break-all">
          {snippet}
        </pre>
      </div>

      <div className="space-y-2">
        <span className="text-[12px] font-bold text-ih-fg-2">Live preview</span>
        <iframe
          src={embedUrl}
          className="w-full min-h-[700px] rounded-md border border-ih-border"
          loading="lazy"
          title="Widget preview"
        />
      </div>
    </section>
  );
}

function EmbedIcon() {
  return (
    <svg className="w-8 h-8 mx-auto text-ih-fg-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
    </svg>
  );
}
