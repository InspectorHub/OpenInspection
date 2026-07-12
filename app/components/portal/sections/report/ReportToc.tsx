import type { ReportOutlineEntry } from "./types";

/**
 * Report Table of Contents (Commercial PCA Phase O). Clickable two-level TOC
 * rendered in the reserved slot (after the front matter / cover, before the
 * report body). On the web it anchor-scrolls; in the PDF, Paged.js is
 * DEFERRED, so the page-number column stays empty even when
 * `showPageNumbers` is passed — the prop is kept so the print path can wire
 * it up without another interface change. `data-level` on each `<li>` drives
 * the level-2 indent (and doubles as the future target-counter style hook).
 *
 * RR's `scrollRestoration="manual"` means a bare `<a href="#id">` does not
 * scroll the viewport (see reference_rr_anchor_scroll_manual_restoration) —
 * every anchor here intercepts the click, scrolls manually, and updates the
 * URL hash via `history.replaceState` so the browser back/forward stack and
 * "current page" indicator stay correct without RR's default anchor handling.
 */
export function ReportToc({
  entries,
  showPageNumbers = false,
}: {
  entries: ReportOutlineEntry[];
  showPageNumbers?: boolean;
}) {
  if (!entries.length) return null;
  return (
    <section
      id="report-toc"
      className="mb-8 print:break-after-page"
      aria-label="Table of contents"
    >
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-ih-fg-4">
        Table of Contents
      </h2>
      <ol className="space-y-1">
        {entries.map((entry) => (
          <li
            key={entry.id}
            data-level={entry.level}
            className={`flex items-baseline gap-2 text-sm ${
              entry.level >= 2 ? "pl-6 text-ih-fg-3" : "font-medium text-ih-fg-1"
            }`}
          >
            <a
              href={`#${entry.id}`}
              className="hover:text-ih-primary transition-colors"
              onClick={(ev) => {
                // RR scrollRestoration='manual' — a bare href doesn't scroll.
                ev.preventDefault();
                const el = document.getElementById(entry.id);
                if (el) {
                  history.replaceState(null, "", `#${entry.id}`);
                  el.scrollIntoView({ behavior: "smooth", block: "start" });
                }
              }}
            >
              {entry.title}
            </a>
            <span
              className="flex-1 border-b border-dotted border-ih-border self-end"
              aria-hidden="true"
            />
            {showPageNumbers && (
              // Reserved for the PDF print path — Paged.js (deferred) fills the
              // real page number via target-counter on this anchor.
              <a
                href={`#${entry.id}`}
                className="toc-pageref text-ih-fg-4 tabular-nums"
                aria-hidden="true"
              />
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
