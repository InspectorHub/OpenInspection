import { useFetcher } from "react-router";
import {
    NotificationPreferences,
    type AlwaysSentItem,
    type ChannelId,
    type ChoiceRow,
} from "~/components/notifications/NotificationPreferences";
import { SmsConsentBlock, type SmsConsent } from "~/components/notifications/SmsConsentBlock";
import { useNotificationSaveToast } from "~/hooks/useNotificationSaveToast";
import { m } from "~/paraglide/messages";

/**
 * The whole notifications surface: consent, the grid, and every rule that ties
 * the two together.
 *
 * Staff, agent and client each had their own copy of this — the fetcher, the
 * saving/saved status, the toast, the save and bulk handlers, and the two
 * derived facts that matter most (`smsUnavailable`, and the locked column that
 * follows from it). Three copies of a rule is three chances for one surface to
 * quietly stop enforcing it, and the one at risk here is the one that keeps the
 * screen agreeing with the send gate.
 *
 * WHAT DIFFERS BETWEEN SURFACES IS ONLY HOW A CHANGE IS SUBMITTED — the intent
 * name each route action listens for, and the extra fields the agent needs to
 * name a company. Both are props. Everything else is the same product.
 */

export interface NotificationSettingsProps {
    alwaysSent: AlwaysSentItem[];
    youChoose: ChoiceRow[];
    /** Null when this reader has no SMS identity to consent with. */
    smsConsent: SmsConsent | null;
    /** The read failed — distinct from "you have nothing", which renders empty. */
    loadError?: string | null;
    locale?: string;
    /** The opt-in page, when this surface can link out to it. */
    manageHref?: string | undefined;
    /** Intent names this surface's route action listens for. */
    intents: { save: string; bulk: string; grant?: string };
    /** Fields every submit carries — the agent's company scope. */
    extraFields?: Record<string, string>;
}

export function NotificationSettings({
    alwaysSent, youChoose, smsConsent, loadError = null,
    locale = "en-US", manageHref, intents, extraFields = {},
}: NotificationSettingsProps) {
    const fetcher = useFetcher<{
        ok?: boolean; success?: boolean; error?: string; intent?: string;
    }>();

    const mine = fetcher.data
        && [intents.save, intents.bulk, intents.grant].includes(fetcher.data.intent);
    const result = mine ? fetcher.data : null;
    // Two shapes in the wild: `{ok}` from the portal actions and `{success}`
    // from the settings ones. Reading both here is what let the three copies
    // disagree about which one counted as a failure.
    const failed = !!result && (result.ok === false || result.success === false);
    const saveError = failed ? (result.error ?? null) : null;
    useNotificationSaveToast({ data: result, failed, error: saveError });

    const busy = fetcher.state !== "idle";
    const status = busy ? ("saving" as const) : ("idle" as const);

    // No consent means no text can arrive, whatever a row says — so the column
    // is DISABLED, not merely unchecked. One place, three surfaces.
    const smsUnavailable = !!smsConsent
        && (smsConsent.state === "revoked" || smsConsent.state === "none");

    const submit = (fields: Record<string, string>) =>
        fetcher.submit({ ...fields, ...extraFields }, { method: "post" });

    return (
        <div className="space-y-5">
            {smsConsent && !loadError && (
                // ABOVE the grid: consent is the gate, the grid is what happens
                // behind it. Stopping is one request — the ledger entry and the
                // Text-column cascade — so the two can never disagree.
                <SmsConsentBlock
                    consent={smsConsent}
                    locale={locale}
                    manageHref={manageHref}
                    busy={busy}
                    onStop={() => submit({
                        intent: intents.bulk, action: "disable", channel: "sms",
                    })}
                    {...(intents.grant
                        ? {
                            onGrant: (disclosureVersion: number) => submit({
                                intent: intents.grant!, disclosureVersion: String(disclosureVersion),
                            }),
                        }
                        : {})}
                />
            )}

            {loadError ? (
                // Never render the two counts when the read failed. "0
                // notifications you cannot switch off" is a confident false
                // answer, and the count is the loudest thing on the card.
                <p className="text-[13px] text-ih-bad-fg">{loadError}</p>
            ) : (
                <NotificationPreferences
                    alwaysSent={alwaysSent}
                    youChoose={youChoose}
                    busy={busy}
                    status={status}
                    lockedChannels={smsUnavailable ? { sms: m.notif_prefs_sms_locked() } : {}}
                    onChange={(classId, channel, enabled) => submit({
                        intent: intents.save, classId, channel, enabled: String(enabled),
                    })}
                    onBulk={(enabled, scope) => submit({
                        intent: intents.bulk,
                        action: enabled ? "enable" : "disable",
                        ...(scope.channel ? { channel: scope.channel } : {}),
                        ...(scope.classId ? { classId: scope.classId } : {}),
                    })}
                />
            )}
        </div>
    );
}

export type { ChannelId };
