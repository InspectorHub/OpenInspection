/**
 * The three view chips above the report body — All / Defects / Summary.
 *
 * Extracted from <ReportView> when the printed two-half render pushed that
 * component past the large-file limit. It was already a self-contained control
 * with one input and one output, and it is `print:hidden` — it never reaches
 * paper, which is exactly the kind of on-screen chrome that should not be
 * inlined in the component that also has to describe a printed document.
 *
 * lint:ds — only `ih-*` design tokens; raw Tailwind colors are forbidden.
 */
import { m } from "~/paraglide/messages";
import type { FilterKey } from "./types";

const FILTERS: FilterKey[] = ["all", "defects", "summary"];

function labelFor(f: FilterKey): string {
  if (f === "all") return m.report_view_filter_all();
  if (f === "defects") return m.report_view_filter_defects();
  return m.report_view_filter_summary();
}

export function ReportFilterChips({
  filter,
  onChange,
}: {
  filter: FilterKey;
  onChange: (next: FilterKey) => void;
}) {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 mb-8 print:hidden">
      <div className="flex gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => onChange(f)}
            className={`px-4 py-1.5 text-xs font-semibold rounded-full transition-all ${
              filter === f
                ? "bg-ih-primary text-ih-primary-fg"
                : "border border-ih-border text-ih-fg-3"
            }`}
          >
            {labelFor(f)}
          </button>
        ))}
      </div>
    </div>
  );
}
