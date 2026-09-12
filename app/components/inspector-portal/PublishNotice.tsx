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
 */
import { useState } from "react";
import { Banner } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

export function PublishNotice({ show }: { show: boolean }) {
    const [dismissed, setDismissed] = useState(false);
    if (!show || dismissed) return null;
    return (
        <Banner tone="success" dismissible onDismiss={() => setDismissed(true)}>
            {m.inspections_hub_publish_ok()}
        </Banner>
    );
}
