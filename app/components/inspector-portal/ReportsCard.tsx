import { useState } from "react";
import { Card, Pill } from "@core/shared-ui";
import { BlockHeading } from "./BlockHeading";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import { useGuardedSubmit } from "~/hooks/useGuardedSubmit";
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
    /**
     * Whether the inspector has written the report-level narrative — the FLAG,
     * not the prose. The text is unbounded free text and arrives from the
     * per-report narrative endpoint an editor opens; a list payload carries
     * only the boolean, for the same reason `hasContent` is a boolean rather
     * than the findings map.
     */
    hasNarrative: boolean;
    canDelete: boolean;
    deleteBlockedReason: "primary" | "published" | null;
    /**
     * #23 — the courtesy translation's state for this deliverable.
     *
     * `withheld` is the one that matters and the one that was completely
     * silent: a report edited and republished stops showing its translation by
     * design, nobody was told, and the first signal was a client asking where
     * the Spanish went. Absent while the state has not been read yet.
     */
    translationState?: "none" | "live" | "withheld";
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
    translationEnabled = false,
}: {
    reports: ReportRow[];
    canManage: boolean;
    formatDate: (iso: string) => string;
    /**
     * #23 — whether this workspace may PRODUCE a translation.
     *
     * Gates REGENERATE only. Removal stays offered while it is off, because
     * cleaning up after switching the feature off is exactly when it is needed.
     */
    translationEnabled?: boolean;
    /**
     * #69 — where to read what clients asked for after these reports went out,
     * or null while the order is unpublished.
     *
     * A HREF, not a boolean: publication is the order-wide `reportStatus`, and
     * this card only knows each deliverable's own `publishedAt`. Re-deriving
     * the rule from those would give a second, subtly different answer to
     * "is this order published" — so the route decides and this card renders.
     */
}) {
    // #106 — deleting a report is irreversible; it goes through the guard.
    const { fetcher: deleteFetcher, submit, busy } = useGuardedSubmit<typeof action>();
    const [deleting, setDeleting] = useState<ReportRow | null>(null);
    // Both translation actions cost or destroy, so both confirm — a custom
    // modal, never window.confirm.
    const [regenerating, setRegenerating] = useState<ReportRow | null>(null);
    const [removingTranslation, setRemovingTranslation] = useState<ReportRow | null>(null);

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
                                    <TranslationState
                                        report={report}
                                        translationEnabled={translationEnabled}
                                        canManage={canManage}
                                        busy={busy}
                                        onRegenerate={() => setRegenerating(report)}
                                        onRemove={() => setRemovingTranslation(report)}
                                    />
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
            {/* Spends money on the workspace's own provider. Says so.
                ⚠️ `confirmLabel` is NOT optional here in practice: ConfirmDialog
                defaults it to "Delete", which on a regenerate dialog tells the
                inspector the opposite of what the button does. Caught in the
                browser, not by a test — every assertion about this dialog was
                about its title and body. */}
            <ConfirmDialog
                open={!!regenerating}
                title={m.courtesy_translation_regenerate_confirm_title()}
                message={m.courtesy_translation_regenerate_confirm_body()}
                confirmLabel={m.courtesy_translation_regenerate()}
                tone="default"
                busy={busy}
                onCancel={() => setRegenerating(null)}
                onConfirm={() => {
                    if (!regenerating) return;
                    if (submit(
                        { intent: "report-translation", action: "regenerate", reportId: regenerating.id },
                        { method: "post" },
                    )) setRegenerating(null);
                }}
            />

            {/* Takes something away from everyone holding a link. Says so. */}
            <ConfirmDialog
                open={!!removingTranslation}
                title={m.courtesy_translation_remove_confirm_title()}
                message={m.courtesy_translation_remove_confirm_body()}
                confirmLabel={m.courtesy_translation_remove()}
                busy={busy}
                onCancel={() => setRemovingTranslation(null)}
                onConfirm={() => {
                    if (!removingTranslation) return;
                    if (submit(
                        { intent: "report-translation", action: "remove", reportId: removingTranslation.id },
                        { method: "post" },
                    )) setRemovingTranslation(null);
                }}
            />

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
                    // Keep the confirmation open when the guard refuses — closing
                    // it would say the report had been deleted.
                    if (submit({ intent: "report-delete", reportId: deleting.id }, { method: "post" })) {
                        setDeleting(null);
                    }
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

/**
 * The translation state for one deliverable, and the two actions on it.
 *
 * Renders NOTHING when there is no state to show and nothing to offer — an
 * unpublished report with no translation and a workspace with the feature off
 * has no business carrying a row of disabled controls.
 *
 * The withheld state NAMES THE REPAIR rather than only the fact. "Withheld" on
 * its own tells an inspector something is wrong and not what to do about it,
 * and the thing to do is one button away.
 */
function TranslationState({
    report,
    translationEnabled,
    canManage,
    busy,
    onRegenerate,
    onRemove,
}: {
    report: ReportRow;
    translationEnabled: boolean;
    canManage: boolean;
    busy: boolean;
    onRegenerate: () => void;
    onRemove: () => void;
}) {
    const state = report.translationState;
    if (!state) return null;
    if (state === "none" && !translationEnabled) return null;

    return (
        <span className="mt-1 flex items-center gap-2 flex-wrap" data-testid="hub-report-translation">
            <Pill tone={state === "live" ? "sat" : state === "withheld" ? "monitor" : "neutral"}>
                {state === "live"
                    ? m.courtesy_translation_state_live()
                    : state === "withheld"
                        ? m.courtesy_translation_state_withheld()
                        : m.courtesy_translation_state_none()}
            </Pill>
            {state === "withheld" && (
                <span className="text-[11px] text-ih-fg-3">
                    {m.courtesy_translation_state_withheld_why()}
                </span>
            )}
            {canManage && translationEnabled && (
                <button
                    type="button"
                    onClick={onRegenerate}
                    disabled={busy}
                    className="text-[12px] font-bold text-ih-fg-3 enabled:hover:text-ih-fg-1 enabled:hover:underline disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    {m.courtesy_translation_regenerate()}
                </button>
            )}
            {/* Offered even when production is switched off — see the prop. */}
            {canManage && state !== "none" && (
                <button
                    type="button"
                    onClick={onRemove}
                    disabled={busy}
                    className="text-[12px] font-bold text-ih-fg-3 enabled:hover:text-ih-bad-fg enabled:hover:underline disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    {m.courtesy_translation_remove()}
                </button>
            )}
        </span>
    );
}
