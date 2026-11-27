/**
 * <PublishNotice> — confirmation that publishing happened, shown after the
 * publish modal closes.
 *
 * Publishing gave no feedback at all: the modal closed and the only sign it had
 * worked was the Report card flipping to a sentence claiming the client had the
 * report — regardless of whether anyone was emailed.
 *
 * F79 — it no longer names WHO was emailed. It used to, computed from the
 * `notifyClient` / `notifyAgent` checkboxes the modal submitted, and those flags
 * reached a service that never read them: delivery is decided by the workspace's
 * `report.published` automation rules. So "Nobody has been emailed yet" was
 * printed over a publish that had just mailed the client. The banner states what
 * this surface can actually know — the report is published — and names the
 * authority that decides the rest, which is the same thing the publish dialog
 * says before the act.
 *
 * Item 3 — one exception, for amendments the choice was offered for: the
 * server DOES honour `notifyClient` there (it decides whether the
 * `report.amended` rules fire at all), so the banner restates which way the
 * submitted choice went, in the editor receipt's own words. A first publish,
 * and a republish after a retract, keep the single sentence: no choice was
 * offered, so there is nothing to restate.
 */
import { useState } from "react";
import { Banner } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

/** What the publish submit chose, snapshotted by the modal at submit time. */
export interface PublishNoticeChoice {
    /** The amendment notice box was offered for this publish. */
    offered: boolean;
    /** The inspector ticked it. */
    notified: boolean;
}

export function PublishNotice({ show, notice }: { show: boolean; notice?: PublishNoticeChoice | null }) {
    const [dismissed, setDismissed] = useState(false);
    if (!show || dismissed) return null;
    return (
        <Banner tone="success" dismissible onDismiss={() => setDismissed(true)}>
            {m.inspections_hub_publish_ok()}
            {notice?.offered && (
                <> {" "}{notice.notified ? m.report_publish_receipt_amendment_notified() : m.report_publish_receipt_amendment_not_notified()}</>
            )}
        </Banner>
    );
}
