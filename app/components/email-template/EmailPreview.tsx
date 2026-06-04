import { useEffect, useRef } from "react";
import { useFetcher } from "react-router";

/**
 * Live email preview. Submits the in-progress subject/blocks to the editor
 * route's `intent=preview` action (debounced) via useFetcher — going through
 * the React Router server so the JWT is relayed to the in-process API (the
 * BFF/token-relay pattern). A direct browser fetch to /api/admin/* would be
 * unauthenticated. The returned HTML renders in an isolated sandboxed iframe.
 */
export function EmailPreview({ subject, blocks }: { trigger: string; subject: string; blocks: Record<string, string> }) {
  const fetcher = useFetcher();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const blocksKey = JSON.stringify(blocks);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const fd = new FormData();
      fd.set("intent", "preview");
      fd.set("subject", subject);
      for (const [k, v] of Object.entries(blocks)) fd.set(`block:${k}`, v);
      fetcher.submit(fd, { method: "post" });
    }, 350);
    return () => { if (timer.current) clearTimeout(timer.current); };
    // Deps intentionally omit `fetcher`/`blocks`: blocksKey is the stable
    // serialization of blocks, and fetcher.submit is referentially unstable
    // per render — including it would re-arm the debounce on every preview
    // response. (react-hooks plugin is not registered in this flat config, so
    // no disable directive — a dangling one fails lint as an unknown rule.)
  }, [subject, blocksKey]);

  const preview =
    fetcher.data && typeof fetcher.data === "object" && "preview" in fetcher.data
      ? (fetcher.data as { preview: { subject: string; html: string } | null }).preview
      : null;
  const loading = fetcher.state !== "idle";
  const html = preview?.html ?? "";
  const renderedSubject = preview?.subject ?? subject;

  return (
    <div className="lg:sticky lg:top-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3">Preview</p>
        <span className={`text-[10px] uppercase tracking-widest ${loading ? "text-ih-watch-fg" : "text-ih-fg-4"}`}>{loading ? "Updating…" : "Sample data"}</span>
      </div>
      <div className="rounded-lg border border-ih-border overflow-hidden shadow-sm bg-white">
        <div className="flex items-center gap-1.5 px-3 h-8 bg-ih-bg-muted border-b border-ih-border">
          <span className="h-2.5 w-2.5 rounded-full bg-ih-border" />
          <span className="h-2.5 w-2.5 rounded-full bg-ih-border" />
          <span className="h-2.5 w-2.5 rounded-full bg-ih-border" />
        </div>
        <div className="px-4 py-2.5 border-b border-ih-border bg-white">
          <p className="text-[11px] text-ih-fg-4">To: client@example.com</p>
          <p className="text-[13px] font-semibold text-ih-fg-1 truncate">{renderedSubject || "—"}</p>
        </div>
        <iframe title="Email preview" srcDoc={html} sandbox="" className="w-full h-[520px] bg-white" />
      </div>
    </div>
  );
}
