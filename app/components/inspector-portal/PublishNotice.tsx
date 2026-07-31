/**
 * <PublishNotice> — what publishing actually did, shown after the publish modal
 * closes.
 *
 * Publishing gave no feedback at all: the modal closed and the only sign it had
 * worked was the Report card flipping to a sentence claiming the client had the
 * report — regardless of whether anyone was emailed. Publishing takes
 * notifyClient / notifyAgent checkboxes, so "nobody" is a legitimate outcome (an
 * inspector publishes to get the link and sends it later), which is why that case
 * reads as information rather than as a warning.
 *
 * The discriminant is computed server-side by the publish action from the form it
 * submitted (`publishNotified` in ~/lib/hub-blocks) — the only place the answer
 * exists, since the hub payload records publication and not delivery.
 */
import { useState } from "react";
import { Banner } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

export type PublishNotified = "both" | "client" | "agent" | "none";

const COPY: Record<PublishNotified, () => string> = {
    both: () => m.inspections_hub_publish_ok_both(),
    client: () => m.inspections_hub_publish_ok_client(),
    agent: () => m.inspections_hub_publish_ok_agent(),
    none: () => m.inspections_hub_publish_ok_none(),
};

export function PublishNotice({ notified }: { notified: PublishNotified | null }) {
    const [dismissed, setDismissed] = useState(false);
    if (!notified || dismissed) return null;
    return (
        <Banner tone={notified === "none" ? "info" : "success"} dismissible onDismiss={() => setDismissed(true)}>
            {COPY[notified]()}
        </Banner>
    );
}
