/**
 * <ProgressView> — the read-only, per-section inspection progress view, extracted
 * from the standalone route `app/routes/public/observe.tsx` so it can be rendered
 * BOTH as a standalone page AND inline inside the unified client-portal Hub
 * (section ④, "Progress").
 *
 * Data-source-agnostic: receives everything via props (no `useLoaderData`).
 * Bare-content convention — it renders the section content ONLY; the page chrome
 * (max-width container, padding, background) is supplied by the host (the Hub, or
 * the standalone route wrapper). It does NOT wrap itself in a full-page shell.
 *
 * lint:ds — only `ih-*` design tokens; raw Tailwind colors are forbidden.
 */

/* ------------------------------------------------------------------ */
/* Types */
/* ------------------------------------------------------------------ */

export interface ProgressSection {
  name: string;
  completedItems: number;
  totalItems: number;
}

export interface ProgressBar extends ProgressSection {
  pct: number;
}

export interface ProgressViewProps {
  address: string;
  date: string | null;
  inspectorName: string;
  status: string;
  sections: ProgressSection[];
  error?: string | null;
}

/* ------------------------------------------------------------------ */
/* Pure helper (unit-testable) */
/* ------------------------------------------------------------------ */

/**
 * Map sections → progress bars with a clamped 0–100 integer percentage.
 * Pure: no React / router. `totalItems > 0 ? round(completed/total*100) : 0`.
 */
export function progressBars(sections: ProgressSection[]): ProgressBar[] {
  return sections.map((section) => {
    const pct =
      section.totalItems > 0
        ? Math.round((section.completedItems / section.totalItems) * 100)
        : 0;
    return { ...section, pct };
  });
}

/* ------------------------------------------------------------------ */
/* Component */
/* ------------------------------------------------------------------ */

export function ProgressView(props: ProgressViewProps) {
  const { address, date, inspectorName, status, sections, error } = props;

  if (error) {
    return (
      <div className="p-8 text-center">
        <h1 className="text-2xl font-bold">Inspection Not Found</h1>
        <p className="text-ih-fg-3 mt-2">
          {error ?? "This observation link is invalid or expired."}
        </p>
      </div>
    );
  }

  const bars = progressBars(sections);

  return (
    <div>
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-xl font-bold">{address}</h1>
          <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-ih-info-bg text-ih-info-fg">
            {status}
          </span>
        </div>
        <p className="text-[13px] text-ih-fg-3">
          Inspector: {inspectorName}
          {date && <span> &middot; {date}</span>}
        </p>
      </div>

      {/* Read-only section progress */}
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ih-fg-3 mb-3">
        Progress
      </h2>
      <div className="space-y-2">
        {bars.map((section, i) => (
          <div key={i} className="p-4 rounded-lg border border-ih-border">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[13px] font-medium">{section.name}</p>
              <span className="text-[11px] text-ih-fg-3">
                {section.completedItems}/{section.totalItems}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-ih-bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-ih-primary transition-all"
                style={{ width: `${section.pct}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default ProgressView;
