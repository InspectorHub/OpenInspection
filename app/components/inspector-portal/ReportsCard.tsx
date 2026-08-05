import { useState } from "react";
import { useFetcher } from "react-router";
import { Card, Pill } from "@core/shared-ui";
import { BlockHeading } from "./BlockHeading";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import { m } from "~/paraglide/messages";
import type { action } from "~/routes/inspector-portal";

/**
 * Mirrors the `reports` entry of `InspectionHubSchema`. Kept as a named export
 * so the route's payload interface points at THIS rather than repeating the
 * shape — a second hand-written copy of a payload is how `invoice.payUrl` went
 * missing on the frontend for a release.
 */
export interface ReportRow {
    id: string;
    kind: "primary" | "ancillary";
    title: string;
    status: string;
    publishedAt: string | null;
    versionCount: number;
    hasContent: boolean;
    canDelete: boolean;
    deleteBlockedReason: "primary" | "published" | null;
}

/**
 * The order's deliverables.
 *
 * One order, several reports: a standard inspection publishes today and the
 * radon report publishes on Thursday, each with its own document, its own
 * signature chain and its own notification. Until this card existed the page
 * showed a single report status pill derived from the inspection row, so an
 * order carrying three documents looked exactly like an order carrying one.
 *
 * `canDelete` is READ, never re-derived. The rule lives in one function on the
 * server (`reportDeleteBlock`) which the DELETE endpoint also enforces, so this
 * card cannot offer an action the API refuses — and the disabled control states
 * the reason rather than failing silently when clicked.
 */
export function ReportsCard({
    reports,
    canManage,
    formatDate,
}: {
    reports: ReportRow[];
    canManage: boolean;
    formatDate: (iso: string) => string;
}) {
    const deleteFetcher = useFetcher<typeof action>();
    const [deleting, setDeleting] = useState<ReportRow | null>(null);

    const busy = deleteFetcher.state !== "idle";
    const done = deleteFetcher.state === "idle" ? deleteFetcher.data : undefined;
    const error = done && "ok" in done && !done.ok && done.intent === "report-delete"
        ? done.error
        : undefined;

    return (
        <Card className="p-5">
            <BlockHeading title={m.inspections_hub_block_reports()} />

            {reports.length === 0 ? (
                <p className="text-[12px] text-ih-fg-3">{m.inspections_hub_reports_empty()}</p>
            ) : (
                <ul className="divide-y divide-ih-border" data-testid="hub-reports-list">
                    {reports.map((report) => {
                        const published = report.publishedAt;
                        return (
                            <li
                                key={report.id}
                                className="flex items-start justify-between gap-3 py-2 text-[13px]"
                                data-testid="hub-report-row"
                            >
                                <span className="min-w-0">
                                    <span className="flex items-center gap-2 flex-wrap">
                                        <span className="text-ih-fg-1 font-medium truncate">{report.title}</span>
                                        {report.kind === "primary" && (
                                            <Pill tone="neutral">{m.inspections_hub_reports_primary()}</Pill>
                                        )}
                                        <Pill tone={published ? "sat" : "monitor"}>
                                            {published
                                                ? m.inspections_hub_reports_status_published()
                                                : m.inspections_hub_reports_status_in_progress()}
                                        </Pill>
                                    </span>
                                    <span className="mt-0.5 block text-[11px] text-ih-fg-3">
                                        {published && m.inspections_hub_reports_published_on({ date: formatDate(published) })}
                                        {published && report.versionCount > 0 && " · "}
                                        {report.versionCount === 1 && m.inspections_hub_reports_versions_one()}
                                        {report.versionCount > 1
                                            && m.inspections_hub_reports_versions_other({ count: report.versionCount })}
                                    </span>
                                </span>

                                {canManage && (
                                    <button
                                        type="button"
                                        onClick={() => setDeleting(report)}
                                        disabled={!report.canDelete || busy}
                                        // Disabled controls give no title on hover in every
                                        // browser, so the reason also rides `aria-label` —
                                        // a greyed-out button that will not say why is the
                                        // silent no-op this card exists to avoid.
                                        title={blockedReason(report) ?? undefined}
                                        aria-label={blockedReason(report) ?? undefined}
                                        className="shrink-0 text-[12px] font-bold text-ih-fg-3 enabled:hover:text-ih-bad-fg enabled:hover:underline disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                        {m.inspections_hub_reports_delete()}
                                    </button>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}

            {error && <p className="text-[12px] text-ih-bad-fg mt-3">{error}</p>}

            {/* Names the report AND what is destroyed with it. A report is not a
                row: it carries the content somebody filled in and its own
                editing history, and none of it comes back. */}
            <ConfirmDialog
                open={!!deleting}
                title={m.inspections_hub_reports_delete_title()}
                message={
                    deleting?.hasContent
                        ? m.inspections_hub_reports_delete_filled({ name: deleting.title })
                        : m.inspections_hub_reports_delete_empty({ name: deleting?.title ?? "" })
                }
                busy={busy}
                onCancel={() => setDeleting(null)}
                onConfirm={() => {
                    if (!deleting) return;
                    deleteFetcher.submit(
                        { intent: "report-delete", reportId: deleting.id },
                        { method: "post" },
                    );
                    setDeleting(null);
                }}
            />
        </Card>
    );
}

function blockedReason(report: ReportRow): string | null {
    if (report.deleteBlockedReason === "primary") return m.inspections_hub_reports_blocked_primary();
    if (report.deleteBlockedReason === "published") return m.inspections_hub_reports_blocked_published();
    return null;
}
