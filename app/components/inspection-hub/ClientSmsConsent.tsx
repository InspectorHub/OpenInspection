import type { useFetcher } from "react-router";
import { Button } from "@core/shared-ui";
import { BlockHeading } from "./BlockHeading";
import type { PillTone } from "~/lib/hub-blocks";
import { m } from "~/paraglide/messages";
import type { action } from "~/routes/inspection-hub";

/**
 * Client SMS consent status + attestation (Track L (E)).
 *
 * It carries a heading, because every other card on this page has one and
 * without it this card read as a divider between two others. And a button
 * rather than an 11px text link, because recording that a client agreed to be
 * texted is a claim the operator stands behind — the weakest control on the
 * page was carrying the page's only legal attestation.
 */
export function ClientSmsConsent({
    consent,
    fetcher,
    attesting,
}: {
    consent: "granted" | "revoked" | "none";
    fetcher: ReturnType<typeof useFetcher<typeof action>>;
    attesting: boolean;
}) {
    const error =
        fetcher.data?.intent === "attest-sms" && !fetcher.data.ok ? fetcher.data.error : undefined;

    const label =
        consent === "granted"
            ? m.inspections_hub_sms_granted()
            : consent === "revoked"
              ? m.inspections_hub_sms_revoked()
              : m.inspections_hub_sms_not_recorded();
    const tone: PillTone = consent === "granted" ? "sat" : consent === "revoked" ? "defect" : "neutral";

    return (
        <div className="space-y-2">
            <BlockHeading title={m.inspections_hub_sms_heading()} pill={{ tone, label }} />
            {consent !== "granted" && (
                <>
                    <p className="text-[12px] text-ih-fg-3">{m.inspections_hub_sms_explainer()}</p>
                    <fetcher.Form method="post">
                        <input type="hidden" name="intent" value="attest-sms" />
                        <Button type="submit" variant="secondary" size="sm" disabled={attesting}>
                            {attesting ? m.inspections_hub_sms_recording() : m.inspections_hub_sms_confirm()}
                        </Button>
                    </fetcher.Form>
                </>
            )}
            {error && <p className="text-[12px] text-ih-bad-fg">{error}</p>}
        </div>
    );
}
