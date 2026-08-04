import { useState } from "react";
import { useFetcher } from "react-router";
import { Card, Button, Pill } from "@core/shared-ui";
import { BlockHeading } from "./BlockHeading";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import { isAdminRole } from "~/lib/access";
import { AddVisitModal } from "./AddVisitModal";
import { m } from "~/paraglide/messages";
import { EVENT_STATUS } from "~/lib/status";
import type { action } from "~/routes/inspector-portal";

export type VisitStatus = "scheduled" | "completed" | "results_received" | "cancelled";

/**
 * One `inspection_events` row as the hub loader hands it over. The timestamps
 * arrive as ISO strings (drizzle `timestamp_ms` → `Date` → JSON), which is why
 * every one of them is formatted through the caller's `formatDate` rather than
 * being sliced here.
 */
export interface VisitRowData {
    id: string;
    eventTypeId: string;
    scheduledAt: string;
    durationMin: number;
    status: VisitStatus;
    notes: string | null;
    completedAt: string | null;
    resultsReceivedAt: string | null;
    cancelledAt: string | null;
}

export interface VisitTypeOption {
    id: string;
    name: string;
    slug: string;
    defaultDurationMin: number | null;
    color: string | null;
    active: boolean;
}

export type VisitAction = "complete" | "results" | "cancel";

/**
 * Which verbs a viewer may see on a visit in a given state.
 *
 * ONE function, read by both the card and the row, because "capabilities come
 * from one function, not from a page". Completion is the FIELD's own act — the
 * inspector standing in the crawlspace is the person who knows the visit is
 * over, so it is offered to every role. Recording that the lab results ARRIVED
 * is an office act about a different event entirely (the sample reaching the
 * lab is not the inspector finishing), so it is owner/manager only.
 *
 * This governs what the UI INVITES. The server is where it is enforced; the two
 * must not be allowed to disagree, which is why this is a pure function a test
 * can pin rather than a set of inline `&&`s.
 */
export function visitActions(role: string, status: VisitStatus): VisitAction[] {
    const admin = isAdminRole(role);
    if (status === EVENT_STATUS.SCHEDULED) return admin ? ["complete", "cancel"] : ["complete"];
    if (status === EVENT_STATUS.COMPLETED) return admin ? ["results", "cancel"] : [];
    // results_received and cancelled are terminal: there is nothing left to offer.
    return [];
}

function statusLabel(status: VisitStatus): string {
    if (status === EVENT_STATUS.COMPLETED) return m.label_status_completed();
    if (status === EVENT_STATUS.RESULTS_RECEIVED) return m.inspections_hub_visits_status_results();
    if (status === EVENT_STATUS.CANCELLED) return m.label_status_cancelled();
    return m.label_status_scheduled();
}

function statusTone(status: VisitStatus): "sat" | "monitor" | "neutral" {
    if (status === EVENT_STATUS.RESULTS_RECEIVED) return "sat";
    if (status === EVENT_STATUS.CANCELLED) return "neutral";
    return "monitor";
}

/**
 * One visit and the verbs its state allows.
 *
 * Exported on its own so the action matrix can be rendered in isolation: the
 * question "does an inspector get offered results-received" is about this row,
 * not about the page that contains it.
 */
export function VisitRow({
    visit,
    typeName,
    role,
    formatDate,
    onAction,
    busy = false,
}: {
    visit: VisitRowData;
    typeName: string;
    role: string;
    formatDate: (iso: string) => string;
    onAction: (action: VisitAction, visit: VisitRowData) => void;
    busy?: boolean;
}) {
    const actions = visitActions(role, visit.status);

    // The transition trail. `inspection_events` records WHEN each transition
    // happened but not WHO made it — there is no actor column — so the row
    // states the times it can prove and claims no attribution it cannot.
    const trail = [
        visit.completedAt && m.inspections_hub_visits_completed_on({ date: formatDate(visit.completedAt) }),
        visit.resultsReceivedAt
            && m.inspections_hub_visits_results_on({ date: formatDate(visit.resultsReceivedAt) }),
        visit.cancelledAt && m.inspections_hub_visits_cancelled_on({ date: formatDate(visit.cancelledAt) }),
    ].filter(Boolean) as string[];

    return (
        <li
            className="flex items-start justify-between gap-3 py-2 text-[13px]"
            data-testid="hub-visit-row"
        >
            <span className="min-w-0">
                <span className="flex items-center gap-2 flex-wrap">
                    <span className="text-ih-fg-1 font-medium truncate">{typeName}</span>
                    <Pill tone={statusTone(visit.status)}>{statusLabel(visit.status)}</Pill>
                </span>
                <span className="mt-0.5 block text-[11px] text-ih-fg-3">
                    {formatDate(visit.scheduledAt)}
                    {trail.length > 0 && ` · ${trail.join(" · ")}`}
                </span>
            </span>

            {actions.length > 0 && (
                <span className="shrink-0 flex items-center gap-3">
                    {actions.includes("complete") && (
                        <button
                            type="button"
                            disabled={busy}
                            onClick={() => onAction("complete", visit)}
                            className="text-[12px] font-bold text-ih-primary enabled:hover:underline disabled:opacity-40"
                        >
                            {m.inspections_hub_visits_action_complete()}
                        </button>
                    )}
                    {actions.includes("results") && (
                        <button
                            type="button"
                            disabled={busy}
                            onClick={() => onAction("results", visit)}
                            className="text-[12px] font-bold text-ih-primary enabled:hover:underline disabled:opacity-40"
                        >
                            {m.inspections_hub_visits_action_results()}
                        </button>
                    )}
                    {actions.includes("cancel") && (
                        <button
                            type="button"
                            disabled={busy}
                            onClick={() => onAction("cancel", visit)}
                            className="text-[12px] font-bold text-ih-fg-3 enabled:hover:text-ih-bad-fg enabled:hover:underline disabled:opacity-40"
                        >
                            {m.inspections_hub_visits_action_cancel()}
                        </button>
                    )}
                </span>
            )}
        </li>
    );
}

/**
 * The visits that make up this job.
 *
 * `inspection_events` has existed, with a full API and an automation trigger per
 * transition, and NO frontend — which is why production holds zero rows. A radon
 * job is a drop-off and a pickup two days apart; without this card the second
 * half of it lived only in the inspector's head.
 *
 * The add picker leads with the visit types the order's own services imply
 * (`services.default_event_type_slugs`), so booking a radon test proposes its
 * drop-off and its pickup instead of leaving the user to remember them. A slug
 * with no surviving event type is simply not proposed — same rule the server's
 * `proposeEventsForService` uses.
 */
export function VisitsCard({
    visits,
    visitTypes,
    suggestedTypeIds,
    role,
    formatDate,
}: {
    visits: VisitRowData[];
    visitTypes: VisitTypeOption[];
    suggestedTypeIds: string[];
    role: string;
    formatDate: (iso: string) => string;
}) {
    const statusFetcher = useFetcher<typeof action>();
    const addFetcher = useFetcher<typeof action>();
    const [addOpen, setAddOpen] = useState(false);
    const [cancelling, setCancelling] = useState<VisitRowData | null>(null);

    const canManage = isAdminRole(role);
    const busy = statusFetcher.state !== "idle" || addFetcher.state !== "idle";
    const typeName = (id: string) => visitTypes.find((t) => t.id === id)?.name ?? id;

    const error = [statusFetcher, addFetcher]
        .map((f) => {
            const d = f.state === "idle" ? f.data : undefined;
            if (!d || !("ok" in d) || d.ok) return undefined;
            return d.intent?.startsWith("visit-") ? d.error : undefined;
        })
        .find(Boolean);

    const submitStatus = (visit: VisitRowData, status: VisitStatus) =>
        statusFetcher.submit(
            { intent: "visit-status", eventId: visit.id, status },
            { method: "post" },
        );

    const handleAction = (verb: VisitAction, visit: VisitRowData) => {
        if (verb === "complete") return submitStatus(visit, "completed");
        if (verb === "results") return submitStatus(visit, "results_received");
        setCancelling(visit);
    };

    return (
        <Card className="p-5">
            <BlockHeading title={m.inspections_hub_block_visits()} />

            {visits.length === 0 ? (
                <p className="text-[12px] text-ih-fg-3">{m.inspections_hub_visits_empty()}</p>
            ) : (
                <ul className="divide-y divide-ih-border" data-testid="hub-visits-list">
                    {visits.map((visit) => (
                        <VisitRow
                            key={visit.id}
                            visit={visit}
                            typeName={typeName(visit.eventTypeId)}
                            role={role}
                            formatDate={formatDate}
                            onAction={handleAction}
                            busy={busy}
                        />
                    ))}
                </ul>
            )}

            {error && <p className="text-[12px] text-ih-bad-fg mt-3">{error}</p>}

            {canManage && (
                <div className="mt-4">
                    <Button variant="secondary" size="sm" onClick={() => setAddOpen(true)} disabled={busy}>
                        {m.inspections_hub_visits_add()}
                    </Button>
                </div>
            )}

            <AddVisitModal
                open={addOpen}
                visitTypes={visitTypes}
                suggestedTypeIds={suggestedTypeIds}
                submitting={addFetcher.state !== "idle"}
                onClose={() => setAddOpen(false)}
                onAdd={(eventTypeId, scheduledAt, durationMin) => {
                    addFetcher.submit(
                        {
                            intent: "visit-add",
                            eventTypeId,
                            scheduledAt,
                            durationMin: String(durationMin),
                        },
                        { method: "post" },
                    );
                    setAddOpen(false);
                }}
            />

            {/* Never window.confirm: a cancelled visit is a commitment withdrawn
                from somebody's calendar, so the question names it. */}
            <ConfirmDialog
                open={!!cancelling}
                title={m.inspections_hub_visits_cancel_title()}
                message={m.inspections_hub_visits_cancel_body({
                    name: cancelling ? typeName(cancelling.eventTypeId) : "",
                })}
                busy={statusFetcher.state !== "idle"}
                onCancel={() => setCancelling(null)}
                onConfirm={() => {
                    if (!cancelling) return;
                    submitStatus(cancelling, "cancelled");
                    setCancelling(null);
                }}
            />
        </Card>
    );
}
