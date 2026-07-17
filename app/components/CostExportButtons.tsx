import { Icon } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

/**
 * Commercial PCA — "Download CSV" / "Download Excel" controls for an
 * inspection's cost tables. Renders TWO SEPARATE buttons (never a single
 * combined control), shared between the report owner-preview toolbar
 * (`variant="fab"`, styled to match the sibling Download PDF / Export to Word
 * pills) and the editor Cost Items panel header (`variant="panel"`, compact
 * inline links).
 *
 * Both links point at the `/resources/cost-export` BFF relay (NOT the raw
 * `/api/*` route) so the download authenticates over local `http://localhost`
 * too — see that route's header comment for the `__Host-` cookie-drop reason.
 * The server stamps `Content-Disposition: attachment; filename=cost-items-<id>`,
 * so the browser saves the file regardless; the `download` attribute is a hint.
 *
 * Gating (has cost items, commercial tier, owner-preview vs. authed editor) is
 * the caller's job — this component only renders the two links. The outer
 * wrapper uses `display:contents` (fab) so each anchor is a standalone pill in
 * the caller's flex row, while still carrying the `cost-export-<variant>` test
 * id the mount sites assert visibility against. lint:ds: only `ih-*` tokens.
 */
export function CostExportButtons({
  inspectionId,
  variant = "fab",
}: {
  inspectionId: string;
  variant?: "fab" | "panel";
}) {
  const href = (format: "csv" | "xlsx") =>
    `/resources/cost-export?inspectionId=${encodeURIComponent(inspectionId)}&format=${format}`;

  // Labels say WHAT is exported (the cost tables) + the format — so they read
  // distinctly next to "Export to Word" / "Download PDF", which export the whole
  // formatted report, not the spreadsheet cost data.
  const CSV_LABEL = m.cost_export_csv_label();
  const XLSX_LABEL = m.cost_export_xlsx_label();
  const CSV_HINT = m.cost_export_csv_hint();
  const XLSX_HINT = m.cost_export_xlsx_hint();

  if (variant === "panel") {
    const link =
      "inline-flex items-center gap-1 text-[12px] font-bold text-ih-primary hover:underline";
    return (
      <div className="flex items-center gap-3" data-testid="cost-export-panel">
        <a href={href("csv")} download className={link} data-testid="cost-export-csv" title={CSV_HINT}>
          <Icon name="download" size={13} /> {m.cost_export_csv_short()}
        </a>
        <a href={href("xlsx")} download className={link} data-testid="cost-export-xlsx" title={XLSX_HINT}>
          <Icon name="download" size={13} /> {m.cost_export_xlsx_short()}
        </a>
      </div>
    );
  }

  // fab — two standalone pills matching the Download PDF / Export to Word style.
  const pill =
    "print:hidden px-5 py-3 rounded-full text-xs font-bold uppercase tracking-widest shadow-ih-popover transition-all flex items-center gap-2 bg-ih-bg-card border border-ih-border text-ih-fg-2 hover:bg-ih-bg-muted";
  return (
    <div className="contents" data-testid="cost-export-fab">
      <a href={href("csv")} download className={pill} data-testid="cost-export-csv" title={CSV_HINT}>
        <Icon name="download" size={16} /> {CSV_LABEL}
      </a>
      <a href={href("xlsx")} download className={pill} data-testid="cost-export-xlsx" title={XLSX_HINT}>
        <Icon name="download" size={16} /> {XLSX_LABEL}
      </a>
    </div>
  );
}
